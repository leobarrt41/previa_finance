// Declarations for static asset imports used by Vite + React
declare module '*.svg' {
  const src: string
  export default src
}

declare module '*.png' {
  const src: string
  export default src
}

declare module '*.jpg' {
  const src: string
  export default src
}

declare module '*.jpeg' {
  const src: string
  export default src
}

declare module '*.css'
declare module '*.module.css'

declare module '*.json' {
  const value: any
  export default value
}
