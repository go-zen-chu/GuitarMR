import sys
from pathlib import Path

# Make the synthetic page helpers importable from the tests.
sys.path.insert(0, str(Path(__file__).parent))
