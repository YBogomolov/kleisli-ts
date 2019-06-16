import { expect } from 'chai';
import { either, left, right, URI } from 'fp-ts/lib/Either';
import { compose, identity } from 'fp-ts/lib/function';

import { getInstancesFor, KleisliIO } from '.';

const K = getInstancesFor(either);

describe('KleisliIO suite', () => {
  describe('Functor laws', () => {
    it('should preserve identity', () => {
      // fmal id ≡ id
      const fa: KleisliIO<URI, string, boolean, string> = K.pure((a) => a ? right(String(a)) : left(String(a)));
      const fa1: KleisliIO<URI, string, boolean, string> = fa.map(identity);

      expect(fa.run(true)).to.deep.equal(fa1.run(true));
      expect(fa.run(false)).to.deep.equal(fa1.run(false));
    });

    it('should preserve composition of morphisms', () => {
      // fmap (f . g) ≡ fmap f . fmap g
      const fa: KleisliIO<URI, string, boolean, string> = K.pure((a) => a ? right(String(a)) : left(String(a)));

      const f = (a: string) => `${a}!`;
      const g = (a: string) => a.length;

      const f_o_g = compose(g, f);

      const fa1 = fa.map(f).map(g);
      const fa2 = fa.map(f_o_g);

      expect(fa1.run(true)).to.deep.equal(fa2.run(true));
      expect(fa1.run(false)).to.deep.equal(fa2.run(false));
    });
  });

  describe('Monad laws', () => {
    it('left identity', () => {
      // return a >>= f ≡ f a
      const f = (a: number) => K.of<never, void, string>(String(a));

      expect(K.of<never, void, number>(42).chain(f).run()).to.deep.equal(f(42).run());
    });

    it('right identity', () => {
      // m >>= return ≡ m
      const m = K.pure<never, void, number>(() => right(42));

      expect(m.chain(K.of).run()).to.deep.equal(m.run());
    });

    it('associativity', () => {
      // (m >>= f) >>= g ≡ m >>= (\x -> f x >>= g)
      const m = K.of<never, void, number>(42);
      const f = (a: number) => K.of<never, void, string>(String(a));
      const g = (s: string) => K.of<never, void, number>(s.length);

      expect(m.chain(f).chain(g).run()).to.deep.equal(m.chain((n) => f(n).chain(g)).run());
    });
  });
});
