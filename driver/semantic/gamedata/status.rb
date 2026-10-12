# =============================================================================
# status.rb — Estado de la carpeta del juego vinculada (lo que muestra la UI y
# lo que decide cuanta legalidad se puede comprobar en modo HeX).
#
# legality.level:
#   full     datos de especies/movimientos/objetos/habilidades y calibracion ok
#   partial  hay datos de especies pero algun dominio no es fiable (se listan los motivos)
#   basic    sin datos de especies (o carpeta que no corresponde al save): solo reglas basicas
# =============================================================================

module Sem
  module GameData
    module Status
      module_function

      def build(session)
        game = session.game
        return { linked: false, legality: legality(nil, nil) } unless game

        cal = session.game_calibration
        {
          linked: true, root: game.root, source: game.source, title: game.info[:title],
          folder: game.info.slice(:hasData, :hasGraphics, :hasPbs, :encrypted),
          data: { state: game.state, version: game.version, domains: game.domains,
                  errors: game.errors.first(5) },
          limits: game.limits, limitSources: game.limit_sources, settingsFiles: game.settings_files,
          calibration: cal,
          legality: legality(game, cal)
        }
      end

      def legality(game, cal)
        reasons = []
        reasons << 'no_game_folder' unless game
        if game
          reasons << 'no_species_data' unless game.species?
          reasons << 'no_move_data' unless game.count(:moves).positive?
          reasons << 'no_item_data' unless game.count(:items).positive?
          reasons << 'no_ability_data' unless game.count(:abilities).positive?
          if cal
            reasons << 'species_mismatch' if cal.dig(:species, :status) == 'mismatch'
            reasons << 'stats_untrusted' if cal.dig(:stats, :status) == 'mismatch'
            reasons << 'exp_untrusted' if cal.dig(:exp, :status) == 'mismatch'
            reasons << 'moves_untrusted' if cal.dig(:moves, :status) == 'mismatch'
            reasons << 'abilities_untrusted' if cal.dig(:abilities, :status) == 'mismatch'
          end
        end
        level = if reasons.empty? then 'full'
                elsif game.nil? || !game.species? || reasons.include?('species_mismatch') then 'basic'
                else 'partial'
                end
        { level: level, reasons: reasons }
      end
    end
  end
end
