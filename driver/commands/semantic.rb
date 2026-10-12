# =============================================================================
# semantic.rb — Comandos de la capa semantica (vistas visuales del save).
# Las vistas devuelven DTOs; los errores llevan `type` + `params` (la UI los
# traduce). Ver driver/semantic/model.rb para la forma de cada DTO.
# =============================================================================

module Sem
  module Api
    module_function

    def model(ctx)
      Api.state!(ctx.session).model
    end

    def require_role!(model, role)
      return if model.binding(role)

      raise DriverError.new('RoleNotFound', "este save no tiene el rol '#{role}'", { role: role.to_s })
    end
  end
end

Commands.register('get_profile') do |ctx, _p|
  { profile: Sem::Api.state!(ctx.session).resolved.summary }
end

Commands.register('set_profile_override', mutates: false) do |ctx, params|
  id = params['profileId']
  unless id.nil? || Sem::Profiles.fetch(id)
    raise DriverError.new('UnknownProfile', "perfil desconocido: #{id}", { profileId: id })
  end

  Sem::Api.state!(ctx.session, redetect: true, override: id)
  { profile: ctx.session.semantic.resolved.summary }
end

Commands.register('get_overview') do |ctx, _p|
  st = Sem::Api.state!(ctx.session)
  m = st.model
  trainer = m.trainer_view
  boxes = m.boxes_view
  bag = m.bag_view
  {
    profile: st.resolved.summary,
    trainer: trainer && trainer.slice(:name, :id, :trainerType, :gender, :money, :coins, :battlePoints, :soot,
                                      :badges, :playTime, :lastSaved, :available, :limits),
    party: m.party_summaries,
    counts: { boxes: boxes && boxes[:boxes].size, boxPokemon: boxes && boxes[:total],
              bagItems: bag && bag[:totalItems], pokemonTotal: st.resolved.scan.pokemon.size },
    pokedex: m.pokedex_counts
  }
end

Commands.register('get_trainer') do |ctx, _p|
  { trainer: Sem::Api.model(ctx).trainer_view }
end

Commands.register('list_party') do |ctx, _p|
  m = Sem::Api.model(ctx)
  Sem::Api.require_role!(m, :trainer)
  { party: m.party_summaries, limits: m.limits }
end

Commands.register('get_pokemon') do |ctx, params|
  m = Sem::Api.model(ctx)
  dto = m.pokemon_detail(params['ref'].to_s)
  raise DriverError.new('PokemonNotFound', "no hay Pokemon en #{params['ref']}", { ref: params['ref'] }) unless dto

  engine = Sem::Legality::Engine.new(ctx.session)
  entity = engine.entity_for_ref(params['ref'].to_s)
  dto[:flags] = entity ? engine.flags_for(entity).map { |f| f.to_h(params['ref'].to_s) } : []
  { pokemon: dto }
end

Commands.register('list_boxes') do |ctx, _p|
  m = Sem::Api.model(ctx)
  Sem::Api.require_role!(m, :storage)
  { storage: m.boxes_view }
end

Commands.register('get_bag') do |ctx, _p|
  m = Sem::Api.model(ctx)
  Sem::Api.require_role!(m, :bag)
  { bag: m.bag_view }
end

Commands.register('get_coverage') do |ctx, _p|
  cov = Sem::Api.state!(ctx.session).coverage
  { total: cov[:total], buckets: cov[:buckets], groupCount: cov[:groups].size }
end

# Grupos "Clase#ivar" con su bucket. `bucket` filtra (classified|custom|world|unclassified).
Commands.register('list_unclassified') do |ctx, params|
  cov = Sem::Api.state!(ctx.session).coverage
  bucket = params['bucket'].to_s
  groups = bucket.empty? ? cov[:groups] : cov[:groups].select { |g| g[:bucket] == bucket }
  query = params['q'].to_s.downcase
  groups = groups.select { |g| g[:key].downcase.include?(query) } unless query.empty?
  page = [params['page'].to_i, 0].max
  size = (params['pageSize'] || 100).to_i.clamp(1, 500)
  { total: groups.size, buckets: cov[:buckets], page: page, pageSize: size,
    groups: groups[page * size, size] || [] }
end

# Indice del campo (vista Avanzado) con esa ruta exacta; construye el indice si hace falta.
Commands.register('locate_field') do |ctx, params|
  path = params['path'].to_s
  fields = ctx.session.collector.fields
  idx = fields.index { |f| f.path == path }
  idx ||= fields.index { |f| f.path.start_with?(path) } unless path.empty?
  { found: !idx.nil?, index: idx, path: path }
end

# ── Edicion ──────────────────────────────────────────────────────────────────

Commands.register('apply_ops', mutates: true) do |ctx, params|
  Sem::Editor.new(ctx.session).apply(params['ops'], label: params['label'], mode: params['mode'])
end

Commands.register('preview_ops') do |ctx, params|
  Sem::Editor.new(ctx.session).preview(params['ops'], mode: params['mode'])
end

Commands.register('undo', mutates: true) { |ctx, _p| Sem::Editor.new(ctx.session).undo }
Commands.register('redo', mutates: true) { |ctx, _p| Sem::Editor.new(ctx.session).redo }

Commands.register('undo_all', mutates: true) do |ctx, _p|
  editor = Sem::Editor.new(ctx.session)
  count = 0
  count += 1 while editor.undo[:applied]
  { applied: count.positive?, undone: count, pendingCount: ctx.session.journal.pending_count,
    redoCount: ctx.session.journal.redo_stack.size }
end

Commands.register('list_history') do |ctx, _p|
  ctx.session.journal.history.merge(pendingCount: ctx.session.journal.pending_count)
end

# Issues de consistencia de las entidades indicadas (o de todo el equipo + bolsa + entrenador).
Commands.register('validate') do |ctx, params|
  model = Sem::Api.model(ctx)
  refs = Array(params['refs'])
  issues = refs.empty? ? Sem::Validator.validate_all(model) : Sem::Validator.validate_refs(model, refs)
  { issues: issues }
end
