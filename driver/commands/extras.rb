# =============================================================================
# extras.rb — Comandos de Pokedex, mundo, estadisticas, Salon de la Fama,
# copias de seguridad, comparacion, busqueda y exportacion de Pokemon.
# =============================================================================

Commands.register('get_pokedex') { |ctx, _p| Sem::Extras.new(ctx.session).pokedex }

Commands.register('get_world') do |ctx, p|
  Sem::Extras.new(ctx.session).world(p['kind'].to_s, q: p['q'], page: p['page'], page_size: p['pageSize'] || 100,
                                                      only_non_default: !!p['onlyNonDefault'])
end

Commands.register('get_stats') { |ctx, _p| Sem::Extras.new(ctx.session).stats }
Commands.register('get_hall_of_fame') { |ctx, _p| Sem::Extras.new(ctx.session).hall_of_fame }

Commands.register('search') do |ctx, p|
  Sem::Extras.new(ctx.session).search(p['q'].to_s, limit: (p['limit'] || 8).to_i.clamp(1, 30))
end

Commands.register('list_backups') do |ctx, _p|
  { backups: Sem::Backups.list(ctx.session.file_path), savePath: ctx.session.file_path }
end

# Restaurar sustituye el archivo en disco: el cliente debe reabrirlo despues. No se permite con cambios pendientes.
Commands.register('restore_backup') do |ctx, p|
  raise DriverError.new('PendingChanges', 'guarda o descarta los cambios antes de restaurar una copia') if ctx.session.dirty?

  Sem::Backups.restore(ctx.session.file_path, p['file'])
end

Commands.register('diff_saves') do |ctx, p|
  other = p['file'] ? File.join(File.dirname(ctx.session.file_path), File.basename(p['file'].to_s)) : p['against']
  Sem::Diff.new(ctx.session, other.to_s).run
end

Commands.register('export_pokemon') do |ctx, p|
  m = Sem::Api.model(ctx)
  found = m.resolve_pokemon(p['ref'].to_s)
  raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{p['ref']}", { ref: p['ref'] }) unless found

  case p['format'].to_s
  when 'showdown' then { format: 'showdown', text: Sem::Transfer.showdown(m, found[:node]) }
  else { format: 'json', data: Sem::Transfer.export_hash(m, ctx.session, found[:node]) }
  end
end
