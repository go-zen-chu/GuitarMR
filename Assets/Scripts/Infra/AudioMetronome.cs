using GuitarMR.Domain;
using GuitarMR.Usecase;
using UnityEngine;

namespace GuitarMR.Infra
{
    /// <summary>
    /// Metronome implementation that schedules procedurally generated click
    /// sounds on the audio DSP clock for sample-accurate timing.
    /// Call Initialize before use; MonoBehaviours cannot take constructor arguments.
    /// </summary>
    public sealed class AudioMetronome : MonoBehaviour, IMetronome
    {
        const double ScheduleLookaheadSeconds = 0.2;
        const double StartDelaySeconds = 0.2;
        const float ClickDurationSeconds = 0.04f;
        const float AccentFrequencyHz = 2600f;
        const float BeatFrequencyHz = 1900f;

        BeatClock clock;
        AudioSource[] sources;
        AudioClip accentClip;
        AudioClip beatClip;
        long nextBeatIndex;

        /// <summary>Injects the beat clock and prepares audio sources and click clips.</summary>
        public void Initialize(BeatClock beatClock)
        {
            clock = beatClock;
            accentClip = CreateClickClip("MetronomeAccent", AccentFrequencyHz);
            beatClip = CreateClickClip("MetronomeBeat", BeatFrequencyHz);
            // Two rotating sources let a scheduled click overlap the tail of the previous one.
            sources = new AudioSource[2];
            for (var i = 0; i < sources.Length; i++)
            {
                var source = gameObject.AddComponent<AudioSource>();
                source.playOnAwake = false;
                source.spatialBlend = 0f;
                sources[i] = source;
            }
        }

        public bool IsRunning => clock != null && clock.IsRunning;

        public int Bpm => clock?.Bpm ?? 0;

        public int BeatsPerBar => clock?.BeatsPerBar ?? 0;

        public int CurrentBeatInBar
        {
            get
            {
                if (!IsRunning)
                {
                    return -1;
                }
                var beat = clock.BeatIndexAt(AudioSettings.dspTime);
                return beat < 0 ? -1 : clock.BeatInBar(beat);
            }
        }

        /// <summary>Starts clicking from beat zero after a short scheduling delay.</summary>
        public void StartTicking()
        {
            if (clock == null || clock.IsRunning)
            {
                return;
            }
            clock.Start(AudioSettings.dspTime + StartDelaySeconds);
            nextBeatIndex = 0;
        }

        /// <summary>Stops clicking and cancels any already scheduled clicks.</summary>
        public void StopTicking()
        {
            if (clock == null)
            {
                return;
            }
            clock.Stop();
            StopScheduledClicks();
        }

        /// <summary>Changes the tempo while keeping the beat phase; reschedules pending clicks.</summary>
        public void SetBpm(int bpm)
        {
            if (clock == null)
            {
                return;
            }
            var now = AudioSettings.dspTime;
            clock.SetBpm(bpm, now);
            if (clock.IsRunning)
            {
                StopScheduledClicks();
                nextBeatIndex = System.Math.Max(0, clock.NextBeatIndexAfter(now));
            }
        }

        /// <summary>Schedules upcoming clicks inside the lookahead window every frame.</summary>
        void Update()
        {
            if (!IsRunning)
            {
                return;
            }
            var horizon = AudioSettings.dspTime + ScheduleLookaheadSeconds;
            while (clock.TimeOfBeat(nextBeatIndex) < horizon)
            {
                var source = sources[nextBeatIndex % sources.Length];
                source.clip = clock.IsAccent(nextBeatIndex) ? accentClip : beatClip;
                source.PlayScheduled(clock.TimeOfBeat(nextBeatIndex));
                nextBeatIndex++;
            }
        }

        /// <summary>Stops both audio sources to cancel clicks queued with PlayScheduled.</summary>
        void StopScheduledClicks()
        {
            foreach (var source in sources)
            {
                source.Stop();
            }
        }

        /// <summary>Generates a short decaying sine burst used as a click sound.</summary>
        static AudioClip CreateClickClip(string clipName, float frequencyHz)
        {
            var sampleRate = AudioSettings.outputSampleRate;
            var sampleCount = Mathf.CeilToInt(sampleRate * ClickDurationSeconds);
            var data = new float[sampleCount];
            for (var i = 0; i < sampleCount; i++)
            {
                var t = (float)i / sampleRate;
                data[i] = Mathf.Sin(2f * Mathf.PI * frequencyHz * t) * Mathf.Exp(-t * 90f) * 0.9f;
            }
            var clip = AudioClip.Create(clipName, sampleCount, 1, sampleRate, false);
            clip.SetData(data, 0);
            return clip;
        }
    }
}
