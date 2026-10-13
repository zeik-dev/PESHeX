# =============================================================================
# calibration.rb — Comprueba que los datos del juego vinculado "explican" los
# Pokemon del save abierto. Es la base de la confianza del modo HeX:
#
#   species    ¿las especies del save existen en el juego vinculado? (carpeta equivocada)
#   stats      ¿la formula del motor reproduce los stats guardados? (bases con otra formula)
#   moves      ¿los movimientos actuales son aprendibles? (los randomizers rompen esto)
#   abilities  ¿las habilidades actuales son las de su especie?
#
# Cada dominio devuelve status: ok | mismatch | unknown (ver `THRESHOLDS`). Una
# regla de legalidad solo se aplica si el dominio que necesita esta `ok`.
# =============================================================================

module Sem
  module GameData
    module Calibration
      MIN_SAMPLE = 3
      THRESHOLDS = { species: 0.9, stats: 0.9, exp: 0.9, moves: 0.8, abilities: 0.8 }.freeze

      module_function

      def run(store, model)
        facts = model.scan.pokemon.map { |ref| PokeFacts.read(ref.node, store) }
        known = facts.select { |f| f.species && store.species_entry(f.species, f.form) }
        {
          species: verdict(:species, facts.size, known.size),
          stats: stats_check(store, known),
          exp: exp_check(store, known),
          moves: moves_check(store, known),
          abilities: abilities_check(store, known)
        }
      rescue StandardError => e
        { error: "#{e.class}: #{e.message}", species: unknown, stats: unknown, exp: unknown, moves: unknown, abilities: unknown }
      end

      def unknown
        { status: 'unknown', checked: 0, matched: 0, ratio: nil }
      end

      def verdict(domain, checked, matched)
        return unknown.merge(checked: checked, matched: matched) if checked < MIN_SAMPLE

        ratio = matched.to_f / checked
        { status: ratio >= THRESHOLDS[domain] ? 'ok' : 'mismatch', checked: checked, matched: matched, ratio: ratio.round(3) }
      end

      def stats_check(store, known)
        checked = 0
        matched = 0
        known.each do |f|
          base = store.base_stats(f.species, f.form)
          next if base.size < 6 || f.level.nil? || f.stats.values.any?(&:nil?)
          next if f.iv.values.any?(&:nil?) || f.ev.values.any?(&:nil?)

          checked += 1
          expected = Tables.calc_all(base, f.level, f.iv, f.ev, f.nature_for_stats || f.nature)
          matched += 1 if expected == f.stats
        end
        verdict(:stats, checked, matched)
      end

      # ¿La experiencia guardada corresponde al nivel segun el grupo de experiencia de la especie?
      def exp_check(store, known)
        checked = 0
        matched = 0
        known.each do |f|
          next if f.level.nil? || f.exp.nil? || f.egg

          checked += 1
          rate = store.growth_rate(f.species, f.form)
          matched += 1 if Tables.level_for_exp(rate, f.exp, store.limits[:maxLevel]) == f.level
        end
        verdict(:exp, checked, matched)
      end

      def moves_check(store, known)
        checked = 0
        matched = 0
        known.each do |f|
          next if f.moves.empty? || f.level.nil?

          checked += 1
          matched += 1 if f.moves.all? { |m| m[:id] && store.move_learnable?(f.species, f.form, f.level, m[:id]) }
        end
        verdict(:moves, checked, matched)
      end

      def abilities_check(store, known)
        checked = 0
        matched = 0
        known.each do |f|
          allowed = store.abilities_for(f.species, f.form)
          next if allowed.empty?

          if f.ability
            checked += 1
            matched += 1 if allowed.include?(f.ability.to_s)
          elsif f.ability_index
            checked += 1
            matched += 1 if f.ability_index < allowed.size
          end
        end
        verdict(:abilities, checked, matched)
      end
    end
  end
end
