using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Polls the Quest touch controllers through the XR input API and raises
    /// edge-triggered events per physical control. Mapping buttons to actions
    /// is left to the use case layer, which is modal (score vs picker).
    /// </summary>
    public sealed class XrControllerInput : MonoBehaviour
    {
        const float StickThreshold = 0.65f;

        public event Action RightPrimaryPressed;
        public event Action RightSecondaryPressed;
        public event Action LeftPrimaryPressed;
        public event Action LeftSecondaryPressed;
        public event Action LeftMenuPressed;

        /// <summary>Fires +1 when the right stick is flicked up and -1 when flicked down.</summary>
        public event Action<int> RightStickStepped;

        struct ControllerSnapshot
        {
            public bool Primary;
            public bool Secondary;
            public bool Menu;
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
                RightPrimaryPressed?.Invoke();
            }
            if (right.Secondary && !previousRight.Secondary)
            {
                RightSecondaryPressed?.Invoke();
            }
            if (right.StickZone == 1 && previousRight.StickZone != 1)
            {
                RightStickStepped?.Invoke(1);
            }
            if (right.StickZone == -1 && previousRight.StickZone != -1)
            {
                RightStickStepped?.Invoke(-1);
            }
            if (left.Primary && !previousLeft.Primary)
            {
                LeftPrimaryPressed?.Invoke();
            }
            if (left.Secondary && !previousLeft.Secondary)
            {
                LeftSecondaryPressed?.Invoke();
            }
            if (left.Menu && !previousLeft.Menu)
            {
                LeftMenuPressed?.Invoke();
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
            device.TryGetFeatureValue(CommonUsages.menuButton, out snapshot.Menu);
            if (device.TryGetFeatureValue(CommonUsages.primary2DAxis, out var stick))
            {
                snapshot.StickZone = stick.y > StickThreshold ? 1 : stick.y < -StickThreshold ? -1 : 0;
            }
            return snapshot;
        }
    }
}
