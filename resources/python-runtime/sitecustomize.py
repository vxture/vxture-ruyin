"""Support bundled Python packages under deep Windows data directories.

Loaded only by bundled tool children through their explicit PYTHONPATH.
No registry, network, package or working-directory changes.
"""

import os
import sys


def _extended_path(value):
    if not value or not os.path.isabs(value) or value.startswith("\\\\?\\"):
        return value
    if value.startswith("\\\\"):
        return "\\\\?\\UNC\\" + value[2:]
    return "\\\\?\\" + os.path.abspath(value)


if os.name == "nt":
    sys.path[:] = [_extended_path(value) for value in sys.path]
