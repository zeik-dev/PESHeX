# =============================================================================
# gamedata.rb — Comandos de la carpeta del juego vinculada: nombres reales,
# catalogo para los selectores, ficha de especie y calculo de stats.
#
# Vincular una carpeta NO modifica el save ni la carpeta; solo cambia lo que las
# vistas pueden mostrar (por eso sube la revision: `bumps`).
# =============================================================================

module Sem
  module GameApi
    module_function

    def game!(session)
      return session.game if session.game

      raise DriverError.new('GameFolderRequired', 'esta accion necesita la carpeta del juego vinculada')
    end

    # Acepta la raiz del juego, o una subcarpeta tipica (Data/Graphics/PBS) y sube un nivel.
    def normalize_root(path)
      root = File.expand_path(path.to_s)
      raise DriverError.new('GameFolderInvalid', "no existe la carpeta '#{path}'", { path: path.to_s }) unless File.directory?(root)

      candidates = [root]
      candidates << File.dirname(root) if File.basename(root).downcase.match?(/\A(data|graphics|pbs|plugins)\z/)
      found = candidates.find { |c| GameData::Locator.game_root?(c) }
      return found if found

      raise DriverError.new('NotAGameFolder', 'la carpeta no parece un juego de Pokémon Essentials', { path: root })
    end

    def link!(session, path, source)
      raise DriverError.new('PendingChanges', 'guarda o descarta los cambios antes de cambiar la carpeta del juego') if session.dirty?

      session.game = nil
      session.game_calibration = nil
      session.reset_legality_baseline!
      if path.nil? || path.to_s.strip.empty?
        Api.state!(session).attach_game(nil, nil)
        return
      end

      store = GameData::Store.load(normalize_root(path), source: source)
      state = Api.state!(session)
      calibration = store.species? ? GameData::Calibration.run(store, state.model) : nil
      session.game = store
      session.game_calibration = calibration
      state.attach_game(store, calibration)
    end
  end
end

Commands.register('set_game_folder', bumps: true) do |ctx, params|
  source = %w[auto manual remembered].include?(params['source']) ? params['source'] : 'manual'
  Sem::GameApi.link!(ctx.session, params['path'], source)
  { game: Sem::GameData::Status.build(ctx.session) }
end

Commands.register('get_game_status') do |ctx, _p|
  { game: Sem::GameData::Status.build(ctx.session) }
end

Commands.register('get_catalog') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  { catalog: Sem::GameData::Catalog.build(game, params['kinds']), state: game.state }
end

Commands.register('get_species') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  detail = Sem::GameData::Catalog.species_detail(game, params['id'], params['form'].to_i)
  raise DriverError.new('SpeciesNotFound', "especie desconocida: #{params['id']}", { id: params['id'] }) unless detail

  { species: detail }
end

# Datos de apoyo de una especie que no cuestan nada hasta que se piden (Pokedex): donde aparece y su numero en las
# Pokedex regionales. { id } -> { encounters: [...], regional: { indice => posicion } }
Commands.register('get_species_extras') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  entry = game.species_entry(params['id'], params['form'].to_i)
  raise DriverError.new('SpeciesNotFound', "especie desconocida: #{params['id']}", { id: params['id'] }) unless entry

  { id: entry.species, encounters: game.encounters_for(entry.species), regional: game.regional_numbers(entry.species) }
end

# Stats esperados por la formula del motor. Dos usos:
#   { ref }                            -> para un Pokemon del save (compara con los guardados)
#   { species, form, level, iv, ev, nature } -> calculo suelto (simulador del editor)
Commands.register('calc_stats') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  m = Sem::Api.model(ctx)
  if params['ref']
    found = m.resolve_pokemon(params['ref'].to_s)
    raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{params['ref']}", { ref: params['ref'] }) unless found

    f = Sem::PokeFacts.read(found[:node], game)
    species, form, level, iv, ev, nature = f.species, f.form, f.level, f.iv, f.ev, f.nature_for_stats || f.nature
    cached = f.stats
  else
    species = params['species']
    form = params['form'].to_i
    level = params['level'].to_i
    iv = Sem::STAT_IDS.to_h { |s| [s, (params.dig('iv', s) || 0).to_i] }
    ev = Sem::STAT_IDS.to_h { |s| [s, (params.dig('ev', s) || 0).to_i] }
    nature = params['nature']
  end
  base = game.base_stats(species, form)
  raise DriverError.new('SpeciesNotFound', "sin datos base para #{species}", { id: species }) if base.size < 6

  rate = game.growth_rate(species, form)
  out = { stats: Sem::GameData::Tables.calc_all(base, level, iv, ev, nature), baseStats: base, growthRate: rate,
          expAtLevel: Sem::GameData::Tables.exp_at(rate, level),
          expAtNext: Sem::GameData::Tables.exp_at(rate, level + 1),
          trusted: m.calibration&.dig(:stats, :status) == 'ok' }
  out[:cached] = cached if cached
  out[:match] = out[:stats] == cached if cached
  out
end

Commands.register('exp_for_level') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  rate = game.growth_rate(params['species'], params['form'].to_i)
  max = game.limits[:maxLevel]
  level = params['level']&.to_i
  exp = params['exp']&.to_i
  { growthRate: rate, exp: level ? Sem::GameData::Tables.exp_at(rate, level) : exp,
    level: exp ? Sem::GameData::Tables.level_for_exp(rate, exp, max) : level }
end
