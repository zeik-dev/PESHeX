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

    # Desconecta la carpeta del juego (y cualquier carga a medias).
    def detach!(session)
      session.game_loading = nil
      session.game = nil
      session.game_calibration = nil
      session.reset_legality_baseline!
      Api.state!(session).attach_game(nil, nil)
    end

    # El save se volvio a leer del disco: la calibracion (cuanto coinciden sus Pokemon con los datos del juego) se recalcula con
    # el save nuevo. Sin juego vinculado, o sin datos de especies, no hay nada que calibrar.
    def recalibrate!(session)
      return unless session.game&.species?

      state = Api.state!(session)
      session.game_calibration = GameData::Calibration.run(session.game, state.model)
      state.attach_game(session.game, session.game_calibration)
    end

    def link!(session, path, source)
      begin_link!(session, path, source)
      return if session.game_loading.nil?

      session.game_loading[:store].steps.each { |id| link_step!(session, id) }
      link_step!(session, 'calibration')
      finish_link!(session)
    end

    # Carga por pasos (para mostrar el progreso real en la UI): begin -> step* -> finish.
    # `begin` desvincula lo anterior y devuelve la lista de pasos; si `path` esta vacio solo desvincula.
    # `cache_dir` (opcional): carpeta de cache de ESTE juego. Con una cache valida el Store sale ya cargado y los pasos terminan
    # al instante; si no, se carga normal y al terminar (`finish_link!`) se escribe la cache.
    def begin_link!(session, path, source, cache_dir = nil)
      raise DriverError.new('PendingChanges', 'guarda o descarta los cambios antes de cambiar la carpeta del juego') if session.dirty?

      detach!(session)
      return { steps: [], root: nil } if path.nil? || path.to_s.strip.empty?

      root = normalize_root(path)
      cache_dir = cache_dir.to_s.strip.empty? ? nil : cache_dir.to_s
      cached = cache_dir && GameData::StoreCache.read(cache_dir, root, source)
      store = cached || GameData::Store.new(root, source: source)
      store.check_root!
      session.game_loading = { store: store, calibration: nil, cache_dir: cache_dir, from_cache: !cached.nil? }
      { root: store.root, steps: store.steps + ['calibration'], cached: !cached.nil? }
    end

    def link_step!(session, id)
      pending = session.game_loading
      raise DriverError.new('NoPendingGameLink', 'no hay una carga de la carpeta del juego en curso') unless pending

      store = pending[:store]
      if id.to_s == 'calibration'
        pending[:calibration] = store.species? ? GameData::Calibration.run(store, Api.state!(session).model) : nil
      else
        store.load_step!(id)
      end
      { step: id.to_s }
    end

    def finish_link!(session)
      pending = session.game_loading
      raise DriverError.new('NoPendingGameLink', 'no hay una carga de la carpeta del juego en curso') unless pending

      store = pending[:store]
      raise DriverError.new('GameLinkIncomplete', 'faltan pasos por cargar', {}) unless store.loaded?

      session.game_loading = nil
      session.game = store
      session.game_calibration = pending[:calibration]
      Api.state!(session).attach_game(store, pending[:calibration])
      # Recien leido del juego: se guarda para la proxima vez (un fallo al escribir no afecta a la vinculacion).
      GameData::StoreCache.write(pending[:cache_dir], store) if pending[:cache_dir] && !pending[:from_cache]
    end

    # ── Precarga (sin partida abierta) ────────────────────────────────────────
    # «Precargar» un juego desde la biblioteca: lee sus datos y deja la cache lista, sin necesitar un save. Va por pasos
    # (begin -> step* -> finish) para mostrar el progreso real; el Store pendiente vive aqui porque no hay sesion.
    @preload = nil

    def preload_begin!(path, cache_dir)
      root = normalize_root(path)
      cache_dir = cache_dir.to_s.strip.empty? ? nil : cache_dir.to_s
      raise DriverError.new('ValidationError', 'falta la carpeta de cache', { code: 'cache_dir_required' }) unless cache_dir

      store = GameData::Store.new(root, source: 'manual')
      store.check_root!
      cached = GameData::StoreCache.valid?(cache_dir, root)
      @preload = { store: store, cache_dir: cache_dir, cached: cached }
      { root: root, steps: cached ? [] : store.steps, cached: cached }
    end

    def preload_step!(id)
      raise DriverError.new('NoPendingGameLink', 'no hay una precarga en curso') unless @preload

      @preload[:store].load_step!(id)
      { step: id.to_s }
    end

    def preload_finish!
      pending = @preload
      raise DriverError.new('NoPendingGameLink', 'no hay una precarga en curso') unless pending

      @preload = nil
      return { root: pending[:store].root, cached: true, fingerprint: GameData::StoreCache.fingerprint(pending[:store].root) } if pending[:cached]

      store = pending[:store]
      raise DriverError.new('GameLinkIncomplete', 'faltan pasos por cargar', {}) unless store.loaded?

      fingerprint = GameData::StoreCache.write(pending[:cache_dir], store)
      { root: store.root, cached: false, fingerprint: fingerprint, state: store.state, species: store.count(:species) }
    end
  end
end

Commands.register('set_game_folder', bumps: true) do |ctx, params|
  source = %w[auto manual remembered].include?(params['source']) ? params['source'] : 'manual'
  Sem::GameApi.link!(ctx.session, params['path'], source)
  { game: Sem::GameData::Status.build(ctx.session) }
end

# Carga por pasos (progreso real): game_link_begin -> game_link_step {id}* -> game_link_finish.
Commands.register('game_link_begin', bumps: true) do |ctx, params|
  source = %w[auto manual remembered].include?(params['source']) ? params['source'] : 'manual'
  Sem::GameApi.begin_link!(ctx.session, params['path'], source, params['cacheDir'])
end

# Precarga de un juego SIN partida abierta (lee sus datos y deja la cache): game_preload_begin -> step* -> finish.
Commands.register('game_preload_begin', needs_session: false) do |_ctx, params|
  Sem::GameApi.preload_begin!(params['path'], params['cacheDir'])
end

Commands.register('game_preload_step', needs_session: false) do |_ctx, params|
  Sem::GameApi.preload_step!(params['step'])
end

Commands.register('game_preload_finish', needs_session: false) do |_ctx, _params|
  Sem::GameApi.preload_finish!
end

Commands.register('game_link_step') do |ctx, params|
  Sem::GameApi.link_step!(ctx.session, params['step'])
end

Commands.register('game_link_finish', bumps: true) do |ctx, _p|
  Sem::GameApi.finish_link!(ctx.session)
  { game: Sem::GameData::Status.build(ctx.session) }
end

Commands.register('get_game_status') do |ctx, _p|
  { game: Sem::GameData::Status.build(ctx.session) }
end

Commands.register('get_catalog') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  { catalog: Sem::GameData::Catalog.build(game, params['kinds']), state: game.state }
end

# OJO: la clave `id` de la peticion es el numero de peticion del protocolo (la UI no puede usarla para otra cosa): la
# especie viaja en `species` (id interno, o numero en bases <= v18). `id` solo se acepta como respaldo en pruebas en proceso.
Commands.register('get_species') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  species = params.key?('species') ? params['species'] : params['id']
  detail = Sem::GameData::Catalog.species_detail(game, species, params['form'].to_i)
  raise DriverError.new('SpeciesNotFound', "especie desconocida: #{species}", { id: species }) unless detail

  { species: detail }
end

# Datos de apoyo de una especie que no cuestan nada hasta que se piden (Pokedex): donde aparece y su numero en las
# Pokedex regionales. { species } -> { encounters: [...], regional: { indice => posicion } }
Commands.register('get_species_extras') do |ctx, params|
  game = Sem::GameApi.game!(ctx.session)
  species = params.key?('species') ? params['species'] : params['id']
  entry = game.species_entry(species, params['form'].to_i)
  raise DriverError.new('SpeciesNotFound', "especie desconocida: #{species}", { id: species }) unless entry

  # Cada parte se lee por separado: si una falla (archivo raro de zonas o de Pokedex regional) la otra se entrega igual y
  # el fallo viaja en `warnings`, en vez de dejar la ficha sin datos.
  warnings = []
  encounters = Sem::GameData::Catalog.guard(warnings, 'encounters') { game.encounters_for(entry.species) } || []
  regional = Sem::GameData::Catalog.guard(warnings, 'regional') { game.regional_numbers(entry.species) } || {}
  # OJO: nada de `id:` aqui. Las claves `id` y `ok` son del protocolo (la respuesta se fusiona con los datos) y el crate Rust
  # da de baja la sesion si el `id` que vuelve no es el de su peticion: era lo que desconectaba el save al abrir la 1.a ficha.
  out = { species: entry.species, encounters: encounters, regional: regional }
  out[:warnings] = warnings unless warnings.empty?
  out
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
