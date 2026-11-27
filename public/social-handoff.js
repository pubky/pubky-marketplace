// The URL comes from the Shop's server-rendered canonical social link. A fragment never reaches
// the server, so preserve it here as a browser would when following an HTTP redirect.
const link = document.querySelector('a[target="_top"]');
if (link) {
  const destination = new URL(link.href);
  destination.hash = window.location.hash;
  link.href = destination.href;
  try {
    window.top.location.replace(destination.href);
  } catch {
    // Some framed deployments allow top-level navigation only after clicking the link.
  }
}
