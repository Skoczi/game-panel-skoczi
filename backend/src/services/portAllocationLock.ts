// One runtime process owns each node database. Keep check + reservation atomic
// across installs, reconfiguration and allocation policy edits in that process.
let busy = false;
export function enterPortAllocationMutation(): () => void {
    if (busy) throw Object.assign(new Error('Another port allocation change is in progress. Refresh and retry.'), { statusCode: 409 });
    busy = true;
    let released = false;
    return () => { if (!released) { released = true; busy = false; } };
}
