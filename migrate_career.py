"""Import an existing career database without overwriting any cloud profile.

Inspect with --database PATH. Add --apply to copy legacy ratings to Firestore.
Keep the source database backup; this script never deletes it.
"""
import argparse
import asyncio
import sqlite3
from pathlib import Path
import career
from career_cloud import cloud
from push_delivery import push

async def main():
    parser=argparse.ArgumentParser();parser.add_argument('--database',type=Path,required=True);parser.add_argument('--apply',action='store_true');args=parser.parse_args()
    path=args.database.resolve();assert path.is_file(),'Database not found'
    with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:keys=[row[0] for row in db.execute('SELECT id FROM players')]
    print('Profiles in source:',len(keys))
    if not args.apply:print('Dry run. Add --apply to copy missing cloud profiles; existing cloud profiles are retained.');return
    assert cloud.enabled,'Firebase cloud rating storage is not configured'
    career.DB=path;copied=skipped=0
    for key in keys:
        if (await cloud.document('rc_career',key))[0] is not None:skipped+=1;continue
        write=cloud.write('rc_career',key,career.read(key),None)
        status,_=await push.call('POST',f'https://firestore.googleapis.com/v1/projects/{push.project}/databases/(default)/documents:commit',{'writes':[write]})
        if status==200:copied+=1
        elif status==409:skipped+=1
        else:raise RuntimeError('Migration write failed; safely rerun after fixing connection')
    print('Copied:',copied,'Already present:',skipped)
    await push.close()

if __name__=='__main__':asyncio.run(main())
