import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

export function database(){
  const sql=new DatabaseSync(':memory:');
  const migrations=new URL('../drizzle/',import.meta.url);
  for(const file of readdirSync(migrations).filter(name=>name.endsWith('.sql')).sort())sql.exec(readFileSync(new URL(file,migrations),'utf8'));
  function prepare(query:string){let args:unknown[]=[];
    return {bind(...values:unknown[]){args=values;return this;},
      async first(){return sql.prepare(query).get(...args as any[])||null;},
      async all(){return {results:sql.prepare(query).all(...args as any[])};},
      async run(){const r=sql.prepare(query).run(...args as any[]);return {meta:{changes:Number(r.changes)}};}};
  }
  return {prepare,async batch(statements:any[]){const out=[];for(const s of statements)out.push(await s.run());return out;}} as unknown as D1Database;
}
