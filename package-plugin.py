"""Package only reviewed static plugin metadata/assets, with no local executable."""
from pathlib import Path
import hashlib
import io
import json
import re
import sys
import zipfile

FILES = ('plugin.json', 'mcp.json', 'README.md', 'LICENSE', 'assets/icon.png', 'assets/site-preview.jpg')
MAX_BYTES = 512 * 1024
ENDPOINT = 'https://api.storeexperts.com.br/mcp'

def package(root, destination):
    root, destination = Path(root).resolve(), Path(destination).resolve()
    sources = {}
    for name in FILES:
        source = root / name
        if source.is_symlink() or not source.is_file() or not source.resolve().is_relative_to(root):
            raise ValueError(f'Invalid package source: {name}')
        if source.stat().st_size > MAX_BYTES:
            raise ValueError('Package source exceeds size limit')
        sources[name] = source.read_bytes()
    if sum(map(len, sources.values())) > MAX_BYTES:
        raise ValueError('Package exceeds size limit')
    manifest = json.loads(sources['plugin.json'])
    servers = json.loads(sources['mcp.json'])
    if servers != {'$schema': 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', 'mcpServers': {'siteperto': {'type': 'streamable-http', 'url': ENDPOINT}}}:
        raise ValueError('Only the fixed remote HTTPS server is allowed')
    extension = manifest.get('extensions', {}).get('com.openai', {})
    if set(manifest.get('extensions', {})) != {'com.openai'} or set(extension) != {'interface'}:
        raise ValueError('Executable hooks, registered private mappings and other extensions are not allowed')
    interface = extension['interface']
    if interface.get('composerIcon') != './assets/icon.png' or interface.get('logo') != './assets/icon.png' or interface.get('screenshots') != ['./assets/site-preview.jpg']:
        raise ValueError('Visual assets must be the bounded package files')
    version = manifest.get('version', '')
    if manifest.get('name') != 'siteperto' or not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid plugin identity/version')
    if not sources['assets/icon.png'].startswith(b'\x89PNG\r\n\x1a\n') or not sources['assets/site-preview.jpg'].startswith(b'\xff\xd8\xff'):
        raise ValueError('Expected PNG icon and JPEG screenshot')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sources.items():
            entry = zipfile.ZipInfo(name, date_time=(2020, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content)
    raw = buffer.getvalue()
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        if archive.testzip() is not None or tuple(archive.namelist()) != FILES:
            raise ValueError('Archive integrity failed')
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / f'siteperto-plugin-{version}.zip'
    temporary = destination / f'.{output.name}.tmp'
    if output.is_symlink() or temporary.is_symlink():
        raise ValueError('Invalid package destination')
    temporary.write_bytes(raw)
    temporary.replace(output)
    digest = hashlib.sha256(raw).hexdigest()
    checksum = destination / f'{output.name}.sha256'
    if checksum.is_symlink():
        raise ValueError('Invalid checksum destination')
    checksum.write_text(f'{digest}  {output.name}\n', encoding='utf-8')
    return {'file': str(output), 'bytes': len(raw), 'sha256': digest, 'entries': len(FILES), 'noExecutableOrCredentialsIncludedByConfiguration': True}

if __name__ == '__main__':
    print(json.dumps(package(Path(__file__).resolve().parent / 'plugin', sys.argv[1])))
