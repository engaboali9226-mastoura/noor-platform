export function NoorWordmark({ titleCase = false }: { titleCase?: boolean } = {}) {
  return <bdi className="noor-wordmark" lang="en" dir="ltr">N<span>{titleCase ? "oo" : "OO"}</span>{titleCase ? "r" : "R"}</bdi>;
}
