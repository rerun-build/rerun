// Each picture links to itself: on a phone, a capture of the whole app opens full size to zoom in.
export const Shot = ({ src, alt, caption }) => (
  <figure className="rr-media">
    <a className="rr-media-light" href={`${src}.light.webp`} target="_blank" rel="noopener">
      <img src={`${src}.light.webp`} alt={alt} loading="lazy" decoding="async" />
    </a>
    <a className="rr-media-dark" href={`${src}.dark.webp`} target="_blank" rel="noopener">
      <img src={`${src}.dark.webp`} alt={alt} loading="lazy" decoding="async" />
    </a>
    {caption ? <figcaption>{caption}</figcaption> : null}
  </figure>
)

export const Loop = ({ src, alt, caption }) => (
  <figure className="rr-media">
    <video
      className="rr-media-light"
      src={`${src}.light.mp4`}
      poster={`${src}.light.webp`}
      aria-label={alt}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
    />
    <video
      className="rr-media-dark"
      src={`${src}.dark.mp4`}
      poster={`${src}.dark.webp`}
      aria-label={alt}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
    />
    {caption ? <figcaption>{caption}</figcaption> : null}
  </figure>
)
