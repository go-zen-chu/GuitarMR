using System;
using GuitarMR.Usecase;

namespace GuitarMR.Smoke
{
    /// <summary>Controller input driven by code instead of the Quest controllers, for scripted checks.</summary>
    public sealed class ScriptedControllerInput : IControllerInput
    {
        public event Action RightPrimaryPressed;
        public event Action RightSecondaryPressed;
        public event Action LeftPrimaryPressed;
        public event Action LeftSecondaryPressed;
        public event Action LeftMenuPressed;
        public event Action<int> RightStickStepped;

        /// <summary>Presses right controller A once.</summary>
        public void PressRightPrimary() => RightPrimaryPressed?.Invoke();

        /// <summary>Presses right controller B once.</summary>
        public void PressRightSecondary() => RightSecondaryPressed?.Invoke();

        /// <summary>Presses left controller X once.</summary>
        public void PressLeftPrimary() => LeftPrimaryPressed?.Invoke();

        /// <summary>Presses left controller Y once.</summary>
        public void PressLeftSecondary() => LeftSecondaryPressed?.Invoke();

        /// <summary>Presses the left controller Menu button once.</summary>
        public void PressLeftMenu() => LeftMenuPressed?.Invoke();

        /// <summary>Flicks the right stick once: +1 up, -1 down.</summary>
        public void StepRightStick(int direction) => RightStickStepped?.Invoke(direction);
    }
}
