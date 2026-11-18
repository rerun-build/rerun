export const Shot = ({ src, alt, caption }) => (
  <figure className="rr-media">
    <img className="rr-media-light" src={`${src}.light.webp`} alt={alt} />
    <img className="rr-media-dark" src={`${src}.dark.webp`} alt={alt} />
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
