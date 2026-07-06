namespace GuitarMR.Domain
{
    /// <summary>
    /// Tracks the highlighted entry inside the score picker list.
    /// Pure logic with no engine dependency so that it can be unit tested.
    /// </summary>
    public sealed class ScoreCatalog
    {
        public int Count { get; }

        /// <summary>Zero-based highlighted entry, or -1 when the catalog is empty.</summary>
        public int Highlighted { get; private set; }

        /// <summary>Creates a catalog of the given size with the initial highlight clamped into range.</summary>
        public ScoreCatalog(int count, int initialIndex)
        {
            Count = count < 0 ? 0 : count;
            Highlighted = Count == 0 ? -1 : ClampIndex(initialIndex);
        }

        public bool IsEmpty => Count == 0;

        /// <summary>Moves the highlight by the given delta, clamped to the list ends; reports whether it changed.</summary>
        public bool Move(int delta)
        {
            if (IsEmpty)
            {
                return false;
            }
            var moved = ClampIndex(Highlighted + delta);
            if (moved == Highlighted)
            {
                return false;
            }
            Highlighted = moved;
            return true;
        }

        /// <summary>Clamps an index into the valid entry range.</summary>
        int ClampIndex(int index)
        {
            return index < 0 ? 0 : index >= Count ? Count - 1 : index;
        }
    }
}
