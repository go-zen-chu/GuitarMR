using System;
using GuitarMR.Domain;
using NUnit.Framework;

namespace GuitarMR.Tests
{
    /// <summary>BDD-style behavior tests for score page navigation.</summary>
    public sealed class ScoreBookTests
    {
        [Test]
        public void If_negative_page_count_given_it_should_throw()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => new ScoreBook(-1));
        }

        [Test]
        public void If_the_book_is_empty_it_should_report_no_current_page_and_reject_navigation()
        {
            var book = new ScoreBook(0);

            Assert.IsTrue(book.IsEmpty);
            Assert.AreEqual(-1, book.CurrentPage);
            Assert.IsFalse(book.Next());
            Assert.IsFalse(book.Previous());
        }

        [Test]
        public void If_the_book_has_pages_it_should_start_at_the_first_page()
        {
            var book = new ScoreBook(3);

            Assert.AreEqual(0, book.CurrentPage);
        }

        [Test]
        public void If_next_is_requested_before_the_last_page_it_should_advance()
        {
            var book = new ScoreBook(3);

            Assert.IsTrue(book.Next());
            Assert.AreEqual(1, book.CurrentPage);
        }

        [Test]
        public void If_next_is_requested_on_the_last_page_it_should_stay()
        {
            var book = new ScoreBook(2);
            book.Next();

            Assert.IsFalse(book.Next());
            Assert.AreEqual(1, book.CurrentPage);
        }

        [Test]
        public void If_previous_is_requested_on_the_first_page_it_should_stay()
        {
            var book = new ScoreBook(2);

            Assert.IsFalse(book.Previous());
            Assert.AreEqual(0, book.CurrentPage);
        }

        [Test]
        public void If_previous_is_requested_after_advancing_it_should_go_back()
        {
            var book = new ScoreBook(2);
            book.Next();

            Assert.IsTrue(book.Previous());
            Assert.AreEqual(0, book.CurrentPage);
        }
    }
}
