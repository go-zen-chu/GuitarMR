using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Polls the Quest touch controllers through the XR input API and raises
    /// edge-triggered events for the practice actions:
    /// right A = next page, right B = previous page, right stick up/down = BPM step,
    /// left X = start/stop metronome, left Y = recenter panels.
    /// </summary>
    public sealed class XrControllerInput : MonoBehaviour
    {
        const float StickThreshold = 0.65f;
        const int BpmStep = 5;

        public event Action NextPagePressed;
        public event Action PreviousPagePressed;
        public event Action ToggleMetronomePressed;
        public event Action RecenterPressed;
        public event Action<int> BpmStepRequested;

        struct ControllerSnapshot
        {
            public bool Primary;
            public bool Secondary;
            public int StickZone;
        }

        static readonly List<InputDevice> DeviceBuffer = new List<InputDevice>();

        ControllerSnapshot previousLeft;
        ControllerSnapshot previousRight;

        /// <summary>Polls both controllers once per frame and fires events on button edges.</summary>
        void Update()
        {
            var right = ReadController(XRNode.RightHand);
            var left = ReadController(XRNode.LeftHand);

            if (right.Primary && !previousRight.Primary)
            {
                NextPagePressed?.Invoke();
            }
            if (right.Secondary && !previousRight.Secondary)
            {
                PreviousPagePressed?.Invoke();
            }
            if (right.StickZone == 1 && previousRight.StickZone != 1)
            {
                BpmStepRequested?.Invoke(BpmStep);
            }
            if (right.StickZone == -1 && previousRight.StickZone != -1)
            {
                BpmStepRequested?.Invoke(-BpmStep);
            }
            if (left.Primary && !previousLeft.Primary)
            {
                ToggleMetronomePressed?.Invoke();
            }
            if (left.Secondary && !previousLeft.Secondary)
            {
                RecenterPressed?.Invoke();
            }

            previousRight = right;
            previousLeft = left;
        }

        /// <summary>Reads button and thumbstick state of the controller at the given hand node.</summary>
        static ControllerSnapshot ReadController(XRNode node)
        {
            var snapshot = new ControllerSnapshot();
            InputDevices.GetDevicesAtXRNode(node, DeviceBuffer);
            if (DeviceBuffer.Count == 0 || !DeviceBuffer[0].isValid)
            {
                return snapshot;
            }
            var device = DeviceBuffer[0];
            device.TryGetFeatureValue(CommonUsages.primaryButton, out snapshot.Primary);
            device.TryGetFeatureValue(CommonUsages.secondaryButton, out snapshot.Secondary);
            if (device.TryGetFeatureValue(CommonUsages.primary2DAxis, out var stick))
            {
                snapshot.StickZone = stick.y > StickThreshold ? 1 : stick.y < -StickThreshold ? -1 : 0;
            }
            return snapshot;
        }
    }
}
