import json
import os
import re
import sys
from pathlib import Path


def allowed(base: str, head: str) -> bool:
    if base == 'dev':
        return re.fullmatch(r'(feat|fix)/[a-z0-9][a-z0-9./-]*', head) is not None
    if base == 'main':
        version = r'(0|[1-9][0-9]*)'
        return re.fullmatch(rf'release/{version}\.{version}\.{version}', head) is not None
    return False


if __name__ == '__main__':
    if '--self-test' in sys.argv:
        for base, head, expected in [
            ('dev', 'feat/initial-frontend', True),
            ('dev', 'fix/api-contract', True),
            ('main', 'release/1.0.0', True),
            ('main', 'release/0.1.0', True),
            ('main', 'dev', False),
            ('main', 'feat/initial-frontend', False),
            ('main', 'fix/api-contract', False),
            ('main', 'release/01.0.0', False),
            ('main', 'release/1.0', False),
            ('dev', 'release/1.0.0', False),
            ('dev', 'main', False),
            ('dev', 'codex/initial-frontend', False),
            ('dev', 'feat/', False),
            ('other', 'feat/example', False),
        ]:
            assert allowed(base, head) == expected, (base, head)
        print('Branch policy checks passed.')
    else:
        event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
        pr = event['pull_request']
        base, head = pr['base']['ref'], pr['head']['ref']
        if not allowed(base, head):
            sys.exit(f'Invalid branch flow: {head} -> {base}. Use feat/fix -> dev or release/x.x.x -> main.')
        print(f'Valid branch flow: {head} -> {base}')
