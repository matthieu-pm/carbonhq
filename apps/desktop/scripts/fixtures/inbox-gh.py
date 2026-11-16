import os
import pathlib
import sys
import time

home = pathlib.Path(os.environ['CARBON_HOME'])
if 'issue' in sys.argv:
    (home / 'gh-entered').touch()
    while not (home / 'release-gh').exists():
        time.sleep(0.01)
    sys.exit(1)
print('gh version 2.83.0')
