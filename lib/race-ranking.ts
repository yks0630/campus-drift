// Rank at the same 0.1 metre precision shown to players and exported to CSV.
export const distanceScore = (distance:number) => Math.round(distance * 10);
export const formatDistance = (distance:number) => (distanceScore(distance) / 10).toFixed(1);
export const DISTANCE_SCORE_SQL = 'CAST(distance * 10 + 0.5 AS INTEGER)';
export function resultsCsv(players:{rank:number;name:string;distance:number;tied?:boolean}[]) {
  return '\uFEFF名次,昵称,距离（米）,是否并列\n'+players.map(p=>[p.rank,
    '"'+p.name.replace(/"/g,'""').replace(/^[=+@\-]/,"'$&")+'"',formatDistance(p.distance),p.tied?'是':'否'].join(',')).join('\n');
}

export function rankPlayers<T extends {distance:number}>(players:T[]) {
  const totals = new Map<number,number>();
  for (const player of players) {
    const score = distanceScore(player.distance);
    totals.set(score,(totals.get(score)||0)+1);
  }
  let rank = 0,previous:number|undefined;
  return players.map((player,index) => {
    const score = distanceScore(player.distance);
    if (score !== previous) rank = index + 1;
    previous = score;
    return {...player,rank,tied:(totals.get(score)||0)>1};
  });
}
