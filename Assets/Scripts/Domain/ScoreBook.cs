using System;

namespace GuitarMR.Domain
{
    /// <summary>
    /// Tracks the current page inside a paged score.
    /// Pure logic with no engine dependency so that it can be unit tested.
    /// </summary>
    public sealed class ScoreBook
    {
        public int PageCount { get; }

        /// <summary>Zero-based current page, or -1 when the book is empty.</summary>
        public int CurrentPage { get; private set; }

        /// <summary>Creates a book with the given number of pages (zero or more).</summary>
        public ScoreBook(int pageCount)
        {
            if (pageCount < 0)
            {
                throw new ArgumentOutOfRangeException(nameof(pageCount), "page count must not be negative");
            }
            PageCount = pageCount;
            CurrentPage = pageCount > 0 ? 0 : -1;
        }

        public bool IsEmpty => PageCount == 0;

        /// <summary>Moves to the next page and reports whether the page changed.</summary>
        public bool Next()
        {
            if (CurrentPage < 0 || CurrentPage >= PageCount - 1)
            {
                return false;
            }
            CurrentPage++;
            return true;
        }

        /// <summary>Moves to the previous page and reports whether the page changed.</summary>
        public bool Previous()
        {
            if (CurrentPage <= 0)
            {
                return false;
            }
            CurrentPage--;
            return true;
        }
    }
}
