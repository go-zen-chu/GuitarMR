using GuitarMR.Domain;
using NUnit.Framework;

namespace GuitarMR.Tests
{
    /// <summary>BDD-style behavior tests for the score picker highlight logic.</summary>
    public sealed class ScoreCatalogTests
    {
        [Test]
        public void If_the_catalog_is_empty_it_should_report_no_highlight_and_reject_moves()
        {
            var catalog = new ScoreCatalog(0, 0);

            Assert.IsTrue(catalog.IsEmpty);
            Assert.AreEqual(-1, catalog.Highlighted);
            Assert.IsFalse(catalog.Move(1));
        }

        [Test]
        public void If_the_initial_index_is_out_of_range_it_should_clamp_into_range()
        {
            Assert.AreEqual(2, new ScoreCatalog(3, 10).Highlighted);
            Assert.AreEqual(0, new ScoreCatalog(3, -5).Highlighted);
        }

        [Test]
        public void If_moved_within_range_it_should_change_the_highlight()
        {
            var catalog = new ScoreCatalog(3, 0);

            Assert.IsTrue(catalog.Move(1));
            Assert.AreEqual(1, catalog.Highlighted);
        }

        [Test]
        public void If_moved_past_the_last_entry_it_should_stay_on_the_last_entry()
        {
            var catalog = new ScoreCatalog(3, 2);

            Assert.IsFalse(catalog.Move(1));
            Assert.AreEqual(2, catalog.Highlighted);
        }

        [Test]
        public void If_moved_before_the_first_entry_it_should_stay_on_the_first_entry()
        {
            var catalog = new ScoreCatalog(3, 0);

            Assert.IsFalse(catalog.Move(-1));
            Assert.AreEqual(0, catalog.Highlighted);
        }
    }
}
