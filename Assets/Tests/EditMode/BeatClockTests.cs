using System;
using GuitarMR.Domain;
using NUnit.Framework;

namespace GuitarMR.Tests
{
    /// <summary>BDD-style behavior tests for the metronome beat timing logic.</summary>
    public sealed class BeatClockTests
    {
        const double TimeTolerance = 1e-9;

        /// <summary>Creates a clock already running with its first beat at the given time.</summary>
        static BeatClock NewRunningClock(int bpm, int beatsPerBar, double firstBeatTime)
        {
            var clock = new BeatClock(bpm, beatsPerBar);
            clock.Start(firstBeatTime);
            return clock;
        }

        [Test]
        public void If_bpm_below_minimum_given_it_should_clamp_to_minimum()
        {
            var clock = new BeatClock(1, 4);

            Assert.AreEqual(BeatClock.MinBpm, clock.Bpm);
        }

        [Test]
        public void If_bpm_above_maximum_given_it_should_clamp_to_maximum()
        {
            var clock = new BeatClock(10000, 4);

            Assert.AreEqual(BeatClock.MaxBpm, clock.Bpm);
        }

        [Test]
        public void If_non_positive_beats_per_bar_given_it_should_throw()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => new BeatClock(120, 0));
        }

        [Test]
        public void If_running_at_120_bpm_it_should_space_beats_half_a_second_apart()
        {
            var clock = NewRunningClock(120, 4, firstBeatTime: 10.0);

            Assert.AreEqual(10.0, clock.TimeOfBeat(0), TimeTolerance);
            Assert.AreEqual(10.5, clock.TimeOfBeat(1), TimeTolerance);
            Assert.AreEqual(12.0, clock.TimeOfBeat(4), TimeTolerance);
        }

        [Test]
        public void If_time_is_before_the_first_beat_it_should_report_beat_zero_as_next()
        {
            var clock = NewRunningClock(120, 4, firstBeatTime: 10.0);

            Assert.AreEqual(0, clock.NextBeatIndexAfter(9.9));
        }

        [Test]
        public void If_time_is_between_beats_it_should_report_the_elapsed_beat_index()
        {
            var clock = NewRunningClock(120, 4, firstBeatTime: 10.0);

            Assert.AreEqual(2, clock.BeatIndexAt(11.25));
        }

        [Test]
        public void If_bpm_changes_while_running_it_should_keep_the_elapsed_beat_time_and_use_the_new_interval_for_the_next_beat()
        {
            var clock = NewRunningClock(120, 4, firstBeatTime: 10.0);

            // Beat 2 happened at 11.0; halve the tempo at 11.25.
            clock.SetBpm(60, now: 11.25);

            Assert.AreEqual(11.0, clock.TimeOfBeat(2), TimeTolerance);
            Assert.AreEqual(12.0, clock.TimeOfBeat(3), TimeTolerance);
        }

        [Test]
        public void If_bpm_changes_before_the_first_beat_it_should_keep_the_first_beat_time()
        {
            var clock = NewRunningClock(120, 4, firstBeatTime: 10.0);

            clock.SetBpm(60, now: 9.5);

            Assert.AreEqual(10.0, clock.TimeOfBeat(0), TimeTolerance);
        }

        [Test]
        public void If_four_beats_per_bar_given_it_should_accent_the_first_beat_of_every_bar()
        {
            var clock = new BeatClock(120, 4);

            Assert.IsTrue(clock.IsAccent(0));
            Assert.IsFalse(clock.IsAccent(2));
            Assert.IsTrue(clock.IsAccent(4));
            Assert.AreEqual(1, clock.BeatInBar(5));
        }
    }
}
