import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NativeArgumentsEditor } from '../components/NativeLifecycleEditor';
function Fixture() {
 const [args, setArgs] = useState(['/bin/bash', '-c', 'set -euo pipefail\ncd /data/serverfiles\nexec ./hlds_linux "$@"', 'hlds', '+map', '{{MAP}}']);
 return <><NativeArgumentsEditor label="Startup arguments" value={args} onChange={setArgs}/><output data-testid="args">{JSON.stringify(args)}</output></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
