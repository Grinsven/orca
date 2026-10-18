import { useEffect, useState, type ComponentType } from 'react'
import { loadLazyWithRetry } from '@/lib/lazy-with-retry'

type SettingsPageModule = { default: ComponentType }

/** Loads a page without delaying its ready content behind a Suspense retry. */
export function createSettingsPageRoute(
  loadPage: () => Promise<SettingsPageModule>
): ComponentType {
  let resolvedPage: ComponentType | null = null
  let pendingPage: Promise<SettingsPageModule> | null = null

  const load = (): Promise<SettingsPageModule> => {
    if (!pendingPage) {
      pendingPage = loadPage()
        .then((module) => {
          resolvedPage = module.default
          return module
        })
        .catch((error: unknown) => {
          pendingPage = null
          throw error
        })
    }
    return pendingPage
  }

  return function SettingsPageRoute() {
    const [Page, setPage] = useState(() => resolvedPage)
    const [failure, setFailure] = useState<{ cause: unknown } | null>(null)

    useEffect(() => {
      if (Page) {
        return
      }
      let mounted = true
      void load().then(
        (module) => {
          if (mounted) {
            setPage(() => module.default)
          }
        },
        (cause: unknown) => {
          if (mounted) {
            setFailure({ cause })
          }
        }
      )
      return () => {
        mounted = false
      }
    }, [Page])

    if (failure) {
      throw failure.cause
    }
    return Page ? <Page /> : null
  }
}

export const SettingsPageRoute = createSettingsPageRoute(() =>
  loadLazyWithRetry(() => import('../components/settings/Settings'), {
    reloadKey: 'settings-page'
  })
)
