/** Maps a pessoa física cedente into the shape the signer/PDF pipeline already understands. */
export function pfSigningForm(pessoa: Record<string, unknown>): Record<string, unknown> {
  const nome = String(pessoa.nome ?? '').trim();
  const cpf = String(pessoa.cpf ?? '');
  const email = String(pessoa.email ?? '').trim();
  const banco = String(pessoa.banco ?? '').trim();

  return {
    ...pessoa,
    partyType: 'pf',
    company: nome,
    cnpj: cpf,
    businessSector: pessoa.profissao ?? '',
    date: pessoa.dataNascimento ?? '',
    email,
    representanteNome: nome,
    representanteCpf: cpf,
    representanteEmail: email,
    representanteRg: pessoa.rg ?? '',
    tipoRepresentante: 'administrador',
    contasBancarias: banco
      ? [
          {
            banco: pessoa.banco,
            agenciaNumero: pessoa.agenciaNumero,
            agenciaNome: '',
            contaCorrente: pessoa.contaCorrente,
            digito: pessoa.digito,
          },
        ]
      : [],
  };
}
