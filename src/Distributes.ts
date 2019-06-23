import { HKT, Kind, Kind2, Kind3, URIS, URIS2, URIS3 } from 'fp-ts/lib/HKT';

/**
 * Represents distributive law between two HKTs:
 * F<G<A>> => G<F<A>>
 */
export type Distributes<F extends URIS, G extends URIS> =
  <A>(fga: HKT<F, HKT<G, A>>) => HKT<G, HKT<F, A>>;
export type Distributes11<F extends URIS, G extends URIS> =
  <A>(fga: Kind<F, Kind<G, A>>) => Kind<G, Kind<F, A>>;
export type Distributes12<F extends URIS, G extends URIS2> =
  <L, A>(fga: Kind<F, Kind2<G, L, A>>) => Kind2<G, L, Kind<F, A>>;
export type Distributes13<F extends URIS, G extends URIS3> =
  <U, L, A>(fga: Kind<F, Kind3<G, U, L, A>>) => Kind3<G, U, L, Kind<F, A>>;
export type Distributes21<F extends URIS2, G extends URIS> =
  <L, A>(fga: Kind2<F, L, Kind<G, A>>) => Kind<G, Kind2<F, L, A>>;
export type Distributes22<F extends URIS2, G extends URIS2> =
  <L, A>(fga: Kind2<F, L, Kind2<G, L, A>>) => Kind2<G, L, Kind2<F, L, A>>;
export type Distributes23<F extends URIS2, G extends URIS3> =
  <U, L, A>(fga: Kind2<F, L, Kind3<G, U, L, A>>) => Kind3<G, U, L, Kind2<F, L, A>>;
export type Distributes31<F extends URIS3, G extends URIS> =
  <U, L, A>(fga: Kind3<F, U, L, Kind<G, A>>) => Kind<G, Kind3<F, U, L, A>>;
export type Distributes32<F extends URIS3, G extends URIS2> =
  <U, L, A>(fga: Kind3<F, U, L, Kind2<G, L, A>>) => Kind2<G, L, Kind3<F, U, L, A>>;
export type Distributes33<F extends URIS3, G extends URIS3> =
  <U, L, A>(fga: Kind3<F, U, L, Kind3<G, U, L, A>>) => Kind3<G, U, L, Kind3<F, U, L, A>>;
