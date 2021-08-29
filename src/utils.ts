/* eslint-disable @typescript-eslint/no-var-requires */
import { AbortController } from 'abort-controller'
import nodeFetch from 'node-fetch'
import { TextDocument, Uri, workspace } from 'vscode'

interface FetchOption {
  timeout?: number
}

export const frontMatterRegex = /^(-{3,}\s*$\n)([\s\S]*?)^(\s*[-.]{3})/m

export const marpDirectiveRegex = /^(marp\s*: +)(.*)\s*$/m

export const detectFrontMatter = (markdown: string): string | undefined => {
  const m = markdown.match(frontMatterRegex)
  return m?.index === 0 ? m[2] : undefined
}

export const detectMarpDocument = (doc: TextDocument): boolean =>
  doc.languageId === 'markdown' && detectMarpFromMarkdown(doc.getText())

export const detectMarpFromMarkdown = (markdown: string): boolean => {
  const frontmatter = detectFrontMatter(markdown)
  if (!frontmatter) return false

  const matched = marpDirectiveRegex.exec(frontmatter)
  return matched ? matched[2] === 'true' : false
}

export const fetch = (url: string, { timeout = 5000 }: FetchOption = {}) => {
  const controller = new AbortController()
  const timeoutCallback = setTimeout(() => controller.abort(), timeout)

  return nodeFetch(url, { signal: controller.signal })
    .then((res) => {
      if (!res.ok) throw new Error(`Failured fetching ${url} (${res.status})`)
      return res.text()
    })
    .finally(() => {
      clearTimeout(timeoutCallback)
    })
}

export const marpConfiguration = () =>
  workspace.getConfiguration('markdown.marp')

export const mathTypesettingConfiguration = () => {
  const conf = marpConfiguration().get<'off' | 'katex' | 'mathjax'>(
    'mathTypesetting'
  )
  return conf ?? 'katex'
}

export const textEncoder = new (globalThis.TextEncoder ??
  (require('util') as typeof import('util')).TextEncoder)()

export const textDecoder = new (globalThis.TextDecoder ??
  (require('util') as typeof import('util')).TextDecoder)()

export const readFile = async (target: Uri) =>
  textDecoder.decode(await workspace.fs.readFile(target))

export const writeFile = (target: Uri, text: string) =>
  workspace.fs.writeFile(target, textEncoder.encode(text))

export const unlink = (target: Uri) =>
  workspace.fs.delete(target, { useTrash: false })
