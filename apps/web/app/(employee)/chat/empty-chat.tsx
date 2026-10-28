/** Questions this build answers whole: from the help center, or the channel of another team. */
const STARTERS = [
  "Qual o horário do service desk?",
  "Como peço acesso a uma pasta do SharePoint?",
  "Como peço reembolso de uma despesa?",
];

/** The chat before the first message: what to write, what the Nexo does, and where to see why it did it. */
export function EmptyChat({ name, onPick }: { name: string; onPick: (text: string) => void }) {
  return (
    <div className="m-auto flex max-w-[480px] flex-col items-center px-6 text-center">
      <h1 className="text-17 font-semibold text-balance text-ink">Oi, {name}. O que está acontecendo?</h1>
      <p className="mt-2 text-14.5 leading-[22px] text-pretty text-ink-3">
        Descreva o problema do seu jeito. O Nexo procura a solução na central de ajuda e indica o canal certo para
        assuntos de RH, financeiro e facilities.
      </p>
      <p className="mt-2 text-12.5 leading-[18px] text-pretty text-ink-3">
        O Nexo é um assistente de IA e pode errar. Em cada resposta,{" "}
        <span className="whitespace-nowrap">“Ver decisão”</span> mostra o que ele entendeu e por quê.
      </p>
      <ul aria-label="Sugestões" className="mt-4 flex flex-wrap justify-center gap-1.5">
        {STARTERS.map((starter) => (
          <li key={starter}>
            <button
              type="button"
              onClick={() => onPick(starter)}
              className="rounded-lg bg-white px-3 py-[7px] text-13.5 font-medium text-ink outline-1 -outline-offset-[0.5px] outline-rule transition-[background-color,scale] duration-150 ease-out hover:bg-desk active:scale-[0.96]"
            >
              {starter}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
