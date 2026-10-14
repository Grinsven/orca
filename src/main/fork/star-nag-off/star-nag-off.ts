import type { Store } from '../../persistence'

/** Jose never wants the "Enjoying Orca?" star prompt; every trigger checks this flag first. */
export function turnOffStarNag(store: Pick<Store, 'getUI' | 'updateUI'>): void {
  if (!store.getUI().starNagCompleted) {
    store.updateUI({ starNagCompleted: true, starNagDeferredUntil: null })
  }
}
