import path from 'path'
import Marp from '@marp-team/marp-core'
import {
  commands,
  workspace,
  Disposable,
  GlobPattern,
  RelativePattern,
  TextDocument,
  Uri,
} from 'vscode'
import { fetch, marpConfiguration, readFile } from './utils'

export enum ThemeType {
  File = 'File',
  Remote = 'Remote',
  VirtualFS = 'VirtualFS',
}

export interface Theme {
  readonly css: string
  readonly onDidChange?: Disposable
  readonly onDidDelete?: Disposable
  readonly path: string
  readonly registered?: boolean
  readonly type: ThemeType
}

export interface SizePreset {
  height: string
  name: string
  width: string
}

const isRemotePath = (path: string) =>
  path.startsWith('https:') || path.startsWith('http:')

const isVirtualPath = (path: string) => /^[a-z0-9.+-]+:\/\/\b/.test(path)

export class Themes {
  observedThemes = new Map<string, Theme>()

  static resolveBaseDirectoryForTheme(doc: TextDocument): Uri {
    const workspaceFolder = workspace.getWorkspaceFolder(doc.uri)
    if (workspaceFolder) return workspaceFolder.uri

    return doc.uri.with({ path: path.dirname(doc.fileName) })
  }

  dispose() {
    this.observedThemes.forEach((theme) => {
      if (theme.onDidChange) theme.onDidChange.dispose()
      if (theme.onDidDelete) theme.onDidDelete.dispose()
    })
    this.observedThemes.clear()
  }

  getMarpThemeSetFor(doc: TextDocument) {
    const marp = new Marp()

    for (const { css } of this.getRegisteredStyles(
      Themes.resolveBaseDirectoryForTheme(doc)
    )) {
      try {
        marp.themeSet.add(css)
      } catch (e) {
        // no ops
      }
    }

    return marp.themeSet
  }

  getRegisteredStyles(rootUri: Uri | undefined): Theme[] {
    return this.getPathsFromConf(rootUri)
      .map((p) => this.observedThemes.get(p))
      .filter((t): t is Theme => !!t)
  }

  getSizePresets(
    doc: TextDocument,
    themeName: string | undefined
  ): SizePreset[] {
    const themeSet = this.getMarpThemeSetFor(doc)
    const theme = themeSet.get(themeName ?? '', true)?.name || 'default'

    const sizeMeta = (themeSet.getThemeMeta(theme, 'size') as string[]) || []
    const sizes = new Map<string, SizePreset>()

    for (const size of sizeMeta) {
      const args = size.split(/\s+/)

      if (args.length === 3) {
        sizes.set(args[0], {
          name: args[0],
          width: args[1],
          height: args[2],
        })
      } else if (args.length === 2 && args[1] === 'false') {
        sizes.delete(args[0])
      }
    }

    return [...sizes.values()]
  }

  loadStyles(rootUri: Uri | undefined): Promise<Theme>[] {
    return this.getPathsFromConf(rootUri).map((p) => this.registerTheme(p))
  }

  private getPathsFromConf(rootUri: Uri | undefined): string[] {
    const themes = marpConfiguration().get<string[]>('themes')

    if (Array.isArray(themes) && themes.length > 0) {
      return this.normalizePaths(themes, rootUri)
    }

    return []
  }

  private normalizePaths(paths: string[], rootUri: Uri | undefined): string[] {
    const normalizedPaths = new Set<string>()

    for (const p of paths) {
      if (typeof p !== 'string') continue

      if (isRemotePath(p)) {
        normalizedPaths.add(p)
      } else if (rootUri) {
        if (rootUri.scheme === 'file') {
          const resolvedPath = path.resolve(rootUri.fsPath, p)

          if (!path.relative(rootUri.fsPath, resolvedPath).startsWith('..')) {
            normalizedPaths.add(resolvedPath)
          }
        } else {
          try {
            const { pathname: relativePath } = new URL(p, 'dummy://dummy/')

            normalizedPaths.add(
              rootUri.with({ path: rootUri.path + relativePath }).toString()
            )
          } catch (e) {
            // no ops
          }
        }
      }
    }

    return [...normalizedPaths.values()]
  }

  private async registerTheme(themePath: string): Promise<Theme> {
    const theme = this.observedThemes.get(themePath)
    if (theme) return theme

    console.log('Fetching theme CSS:', themePath)

    const type: ThemeType = (() => {
      if (isRemotePath(themePath)) return ThemeType.Remote
      if (isVirtualPath(themePath)) return ThemeType.VirtualFS

      return ThemeType.File
    })()

    const css = await (async (): Promise<string> => {
      switch (type) {
        case ThemeType.File:
          return await readFile(Uri.file(themePath))
        case ThemeType.Remote:
          return await fetch(themePath, { timeout: 5000 })
        case ThemeType.VirtualFS:
          return await readFile(Uri.parse(themePath, true))
      }
    })()

    const registeredTheme: Theme = { css, type, path: themePath }

    const watcherPattern: GlobPattern | undefined = (() => {
      switch (type) {
        case ThemeType.File:
          return new RelativePattern(
            path.dirname(themePath),
            path.basename(themePath)
          )
        case ThemeType.VirtualFS:
          try {
            const baseUri = Uri.parse(themePath, true)
            const { pathname } = new URL('.', themePath)

            return new RelativePattern(
              baseUri.with({ path: pathname }),
              baseUri.path.split('/').pop()! // eslint-disable-line @typescript-eslint/no-non-null-assertion
            )
          } catch (e) {
            // no ops
          }
      }

      return undefined
    })()

    if (watcherPattern) {
      const fsWatcher = workspace.createFileSystemWatcher(watcherPattern)

      const onDidChange = fsWatcher.onDidChange(async () => {
        onDidChange.dispose()
        this.observedThemes.delete(themePath)

        await this.registerTheme(themePath)
        commands.executeCommand('markdown.preview.refresh')
      })

      const onDidDelete = fsWatcher.onDidDelete(() => {
        onDidDelete.dispose()
        this.observedThemes.delete(themePath)
      })

      Object.assign(registeredTheme, { onDidChange, onDidDelete })
    }

    this.observedThemes.set(themePath, registeredTheme)

    return { ...registeredTheme, registered: true }
  }
}

export default new Themes()
