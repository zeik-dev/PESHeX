# =============================================================================
# legality.rb — Modos HeX/HaX y comprobacion de legalidad.
#
#   set_mode {mode}                 cambia de modo (sube la revision: las insignias dependen de el)
#   get_mode                        modo actual
#   check_legality {refs?, includeInfo?}
#                                   -> {mode, coverage{level,reasons,evaluated,skipped},
#                                       summary{illegal,warning,info,checked,refs}, flags{ref:[...]}}
#
# El informe global se cachea por revision (y por includeInfo).
# =============================================================================

Commands.register('set_mode', bumps: true) do |ctx, params|
  mode = params['mode'].to_s
  unless Sem::Legality::MODES.include?(mode)
    raise DriverError.new('ValidationError', "modo desconocido: #{mode.inspect}", { code: 'unknown_mode', mode: mode })
  end

  ctx.session.mode = mode
  { mode: mode }
end

Commands.register('get_mode') { |ctx, _p| { mode: ctx.session.mode } }

Commands.register('check_legality') do |ctx, params|
  session = ctx.session
  Sem::Api.state!(session)
  include_info = !!params['includeInfo']
  refs = Array(params['refs']).map(&:to_s)
  key = [session.revision, include_info, refs.sort]
  cache = session.instance_variable_get(:@legality_cache)
  unless cache && cache[:key] == key
    cache = { key: key, report: Sem::Legality::Engine.new(session).report(include_info: include_info, refs: refs) }
    session.instance_variable_set(:@legality_cache, cache)
  end
  cache[:report].merge(mode: session.mode)
end
