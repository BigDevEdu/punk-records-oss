export function Page({ title }: { title: string }) {
  return (
    <>
      <div className="topbar"><span>{title}</span></div>
      <div className="content" />
    </>
  );
}
