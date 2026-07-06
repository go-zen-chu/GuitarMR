using System.Collections;
using System.IO;
using GuitarMR.Domain;
using GuitarMR.Infra;
using GuitarMR.Usecase;
using Unity.XR.CoreUtils;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.XR.ARFoundation;

namespace GuitarMR.App
{
    /// <summary>
    /// Composition root of the application. Builds the XR rig with passthrough,
    /// the score and metronome panels, wires controller input into the practice
    /// use case, and places the panels in front of the player.
    /// </summary>
    public sealed class AppBootstrap : MonoBehaviour
    {
        const int DefaultBpm = 90;
        const int BeatsPerBar = 4;
        const float PanelDistanceMeters = 1.1f;
        const float PanelHeightOffsetMeters = -0.1f;

        Transform cameraTransform;
        Transform panelRoot;
        PracticeController controller;

        /// <summary>Builds the whole scene and starts the practice session.</summary>
        void Start()
        {
            cameraTransform = CreateXrRig();
            CreateArSession();

            panelRoot = new GameObject("PanelRoot").transform;
            var scorePanel = new ScorePanel(panelRoot);
            var metronomePanel = new MetronomePanel(panelRoot, BeatsPerBar);

            var metronome = gameObject.AddComponent<AudioMetronome>();
            metronome.Initialize(new BeatClock(DefaultBpm, BeatsPerBar));

            controller = new PracticeController(metronome, CreateScoreSource(), scorePanel, metronomePanel);

            var input = gameObject.AddComponent<XrControllerInput>();
            input.NextPagePressed += controller.ShowNextPage;
            input.PreviousPagePressed += controller.ShowPreviousPage;
            input.ToggleMetronomePressed += controller.ToggleMetronome;
            input.BpmStepRequested += controller.AddBpm;
            input.RecenterPressed += RecenterPanels;

            controller.LoadScore();
            StartCoroutine(RecenterAfterTrackingStarts());
        }

        /// <summary>Keeps the metronome display in sync with the audio clock.</summary>
        void Update()
        {
            controller?.Tick();
        }

        /// <summary>Creates the XR origin with a passthrough-ready tracked camera and returns the camera transform.</summary>
        Transform CreateXrRig()
        {
            var originGo = new GameObject("XR Origin");
            var offsetGo = new GameObject("Camera Offset");
            offsetGo.transform.SetParent(originGo.transform, false);

            var cameraGo = new GameObject("Main Camera") { tag = "MainCamera" };
            cameraGo.transform.SetParent(offsetGo.transform, false);
            var camera = cameraGo.AddComponent<Camera>();
            // Transparent solid background lets the Quest compositor show passthrough behind the scene.
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = new Color(0f, 0f, 0f, 0f);
            camera.nearClipPlane = 0.05f;
            cameraGo.AddComponent<AudioListener>();
            cameraGo.AddComponent<ARCameraManager>();
            AddHeadTracking(cameraGo);

            var origin = originGo.AddComponent<XROrigin>();
            origin.Camera = camera;
            origin.CameraFloorOffsetObject = offsetGo;
            origin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.Floor;
            return cameraGo.transform;
        }

        /// <summary>Adds a tracked pose driver bound to the HMD center eye pose.</summary>
        static void AddHeadTracking(GameObject cameraGo)
        {
            var driver = cameraGo.AddComponent<TrackedPoseDriver>();
            driver.positionInput = new InputActionProperty(CreateEnabledAction("<XRHMD>/centerEyePosition"));
            driver.rotationInput = new InputActionProperty(CreateEnabledAction("<XRHMD>/centerEyeRotation"));
        }

        /// <summary>Creates and enables an input action with a single binding.</summary>
        static InputAction CreateEnabledAction(string binding)
        {
            var action = new InputAction(binding: binding);
            action.Enable();
            return action;
        }

        /// <summary>Creates the AR session required by AR Foundation features such as passthrough.</summary>
        static void CreateArSession()
        {
            new GameObject("AR Session").AddComponent<ARSession>();
        }

        /// <summary>Builds the score source: PDFs first on device, image files as fallback.</summary>
        static IScoreSource CreateScoreSource()
        {
            var scoresDirectory = Path.Combine(Application.persistentDataPath, "Scores");
#if UNITY_ANDROID && !UNITY_EDITOR
            return new CompositeScoreSource(
                new AndroidPdfScoreSource(scoresDirectory),
                new ImageFolderScoreSource(scoresDirectory));
#else
            return new ImageFolderScoreSource(scoresDirectory);
#endif
        }

        /// <summary>Places the panels in front of the player once head tracking has produced a pose.</summary>
        IEnumerator RecenterAfterTrackingStarts()
        {
            // Right after launch the head pose is still at the origin; wait until it moves.
            var deadline = Time.time + 3f;
            while (Time.time < deadline && cameraTransform.localPosition == Vector3.zero)
            {
                yield return null;
            }
            RecenterPanels();
        }

        /// <summary>Moves the panels to a comfortable reading position in front of the player.</summary>
        void RecenterPanels()
        {
            var forward = cameraTransform.forward;
            forward.y = 0f;
            forward = forward.sqrMagnitude < 0.001f ? Vector3.forward : forward.normalized;
            panelRoot.position = cameraTransform.position
                + forward * PanelDistanceMeters
                + Vector3.up * PanelHeightOffsetMeters;
            panelRoot.rotation = Quaternion.LookRotation(forward);
        }
    }
}
