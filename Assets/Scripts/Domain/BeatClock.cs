using System;

namespace GuitarMR.Domain
{
    /// <summary>
    /// Computes metronome beat timing on an absolute time axis (e.g. audio DSP time).
    /// Pure logic with no engine dependency so that it can be unit tested.
    /// </summary>
    public sealed class BeatClock
    {
        public const int MinBpm = 30;
        public const int MaxBpm = 300;

        public int Bpm { get; private set; }
        public int BeatsPerBar { get; }
        public bool IsRunning { get; private set; }

        // Beat times are derived from an anchor pair so that changing the BPM
        // can preserve the timing of beats that already elapsed.
        double anchorTime;
        long anchorIndex;

        /// <summary>
        /// Creates a clock with the given tempo and beats per bar.
        /// The tempo is clamped into the supported range; beatsPerBar must be positive.
        /// </summary>
        public BeatClock(int bpm, int beatsPerBar)
        {
            if (beatsPerBar < 1)
            {
                throw new ArgumentOutOfRangeException(nameof(beatsPerBar), "beats per bar must be positive");
            }
            Bpm = Clamp(bpm);
            BeatsPerBar = beatsPerBar;
        }

        public double SecondsPerBeat => 60.0 / Bpm;

        /// <summary>Starts the clock so that beat index 0 occurs at the given time.</summary>
        public void Start(double firstBeatTime)
        {
            anchorTime = firstBeatTime;
            anchorIndex = 0;
            IsRunning = true;
        }

        /// <summary>Stops the clock; beat queries are undefined until the next Start.</summary>
        public void Stop()
        {
            IsRunning = false;
        }

        /// <summary>
        /// Changes the tempo. While running, the anchor is rebased onto the most recent
        /// elapsed beat so past beat times stay valid and the next beat comes one new
        /// interval after the current one.
        /// </summary>
        public void SetBpm(int bpm, double now)
        {
            if (IsRunning && now >= anchorTime)
            {
                var currentBeat = BeatIndexAt(now);
                anchorTime = TimeOfBeat(currentBeat);
                anchorIndex = currentBeat;
            }
            Bpm = Clamp(bpm);
        }

        /// <summary>Returns the index of the last beat at or before the given time (negative before the first beat).</summary>
        public long BeatIndexAt(double time)
        {
            return anchorIndex + (long)Math.Floor((time - anchorTime) / SecondsPerBeat);
        }

        /// <summary>Returns the absolute time at which the given beat occurs.</summary>
        public double TimeOfBeat(long beatIndex)
        {
            return anchorTime + (beatIndex - anchorIndex) * SecondsPerBeat;
        }

        /// <summary>Returns the index of the first beat strictly after the given time.</summary>
        public long NextBeatIndexAfter(double time)
        {
            return BeatIndexAt(time) + 1;
        }

        /// <summary>Returns the zero-based position of the beat inside its bar.</summary>
        public int BeatInBar(long beatIndex)
        {
            return (int)(((beatIndex % BeatsPerBar) + BeatsPerBar) % BeatsPerBar);
        }

        /// <summary>Returns whether the beat is the accented first beat of a bar.</summary>
        public bool IsAccent(long beatIndex)
        {
            return BeatInBar(beatIndex) == 0;
        }

        /// <summary>Clamps a tempo into the supported BPM range.</summary>
        static int Clamp(int bpm)
        {
            return Math.Min(MaxBpm, Math.Max(MinBpm, bpm));
        }
    }
}
