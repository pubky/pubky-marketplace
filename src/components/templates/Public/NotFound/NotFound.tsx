/** The app's 404 screen: the root `not-found` page, and store routes the viewer may not open. */
export function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center">
      <h2 className="text-2xl font-bold">Not Found</h2>
      <p>Could not find requested resource</p>
    </div>
  );
}
