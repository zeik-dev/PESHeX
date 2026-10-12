# =============================================================================
# rules_pokemon.rb — Reglas de legalidad de un Pokemon. Cada regla declara lo
# que NECESITA (`needs`): datos del juego vinculado y que su calibracion contra
# el save sea fiable. Sin eso se omite (no se adivina).
#
# Una regla recibe (ctx, f) y devuelve una lista de Flag o nil.
# =============================================================================

module Sem
  module Legality
    Rule = Struct.new(:code, :needs, :fn)

    module PokemonRules
      STATUSES = %w[NONE SLEEP POISON BURN PARALYSIS FROZEN].freeze

      module_function

      def ill(code, subject = nil, **params)
        Legality.flag(code, 'illegal', subject, **params)
      end

      def warn(code, subject = nil, **params)
        Legality.flag(code, 'warning', subject, **params)
      end

      def info(code, subject = nil, **params)
        Legality.flag(code, 'info', subject, **params)
      end

      def nature_ok?(v)
        return true if v.nil?
        return v.between?(0, 24) if v.is_a?(Integer)

        GameData::Tables::NATURE_IDS.include?(v.to_s.upcase)
      end

      def species_entry(ctx, f)
        f.species && ctx.game&.species_entry(f.species, f.form)
      end

      RULES = [
        Rule.new('species_missing', :basic, lambda { |_c, f|
          [ill('species_missing')] if f.species.nil? || f.species.to_s.empty?
        }),
        Rule.new('species_unknown', :species, lambda { |c, f|
          next if f.species.nil? || f.species.to_s.empty?

          [ill('species_unknown', f.species.to_s)] unless c.game.species_entry(f.species, 0)
        }),
        Rule.new('form_unknown', :species, lambda { |c, f|
          next unless f.species && f.form.to_i.positive? && c.game.species_entry(f.species, 0)

          [warn('form_unknown', f.form, species: f.species.to_s, form: f.form)] unless c.game.table(:species)["#{f.species}_#{f.form}"]
        }),
        Rule.new('level_range', :basic, lambda { |c, f|
          next if f.level.nil?

          max = c.limits[:maxLevel]
          [ill('level_range', nil, value: f.level, min: 1, max: max)] if f.level < 1 || f.level > max
        }),
        Rule.new('exp_negative', :basic, lambda { |_c, f|
          [ill('exp_negative', nil, value: f.exp)] if f.exp && f.exp.negative?
        }),
        Rule.new('exp_level_mismatch', :exp, lambda { |c, f|
          next if f.egg || f.exp.nil? || f.level.nil? || !species_entry(c, f)
          next if f.exp.negative? || f.level < 1 || f.level > c.limits[:maxLevel]

          rate = c.game.growth_rate(f.species, f.form)
          expected = GameData::Tables.level_for_exp(rate, f.exp, c.limits[:maxLevel])
          [ill('exp_level_mismatch', nil, level: f.level, exp: f.exp, expectedLevel: expected)] if expected != f.level
        }),
        Rule.new('level_below_minimum', :species, lambda { |c, f|
          next if f.egg || f.level.nil? || !species_entry(c, f)

          min = c.game.minimum_level(f.species)
          [warn('level_below_minimum', nil, level: f.level, minimum: min)] if f.level < min
        }),
        Rule.new('nature_invalid', :basic, lambda { |_c, f|
          out = []
          out << ill('nature_invalid', 'nature', value: f.nature.to_s) unless nature_ok?(f.nature)
          out << ill('nature_invalid', 'nature_for_stats', value: f.nature_for_stats.to_s) unless nature_ok?(f.nature_for_stats)
          out unless out.empty?
        }),
        Rule.new('gender_invalid', :basic, lambda { |_c, f|
          [ill('gender_invalid', nil, value: f.gender)] if f.gender && !f.gender.between?(0, 2)
        }),
        Rule.new('gender_forbidden', :species, lambda { |c, f|
          next if f.gender.nil? || f.egg || !species_entry(c, f)

          ratio = GameData::Tables::GENDER_RATIOS[c.game.gender_ratio(f.species, f.form).to_s]
          next unless ratio

          allowed = ratio[:only] ? [ratio[:only]] : [0, 1]
          [ill('gender_forbidden', nil, gender: f.gender, ratio: c.game.gender_ratio(f.species, f.form))] unless allowed.include?(f.gender)
        }),
        Rule.new('gender_pid_mismatch', :species, lambda { |c, f|
          next if f.gender.nil? || f.personal_id.nil? || f.egg || !species_entry(c, f)

          ratio = GameData::Tables::GENDER_RATIOS[c.game.gender_ratio(f.species, f.form).to_s]
          chance = ratio && !ratio[:only] ? ratio[:female] : nil
          next unless chance && f.gender.between?(0, 1)

          expected = (f.personal_id & 0xFF) < chance ? 1 : 0
          [info('gender_pid_mismatch', nil, gender: f.gender, expected: expected)] if expected != f.gender
        }),
        Rule.new('ability_not_allowed', :abilities, lambda { |c, f|
          next if f.ability.nil? || !species_entry(c, f)

          allowed = c.game.abilities_for(f.species, f.form)
          next if allowed.empty?

          [ill('ability_not_allowed', f.ability.to_s)] unless allowed.include?(f.ability.to_s)
        }),
        Rule.new('ability_index_mismatch', :abilities, lambda { |c, f|
          next if f.ability.nil? || f.ability_index.nil? || !species_entry(c, f)

          allowed = c.game.abilities_for(f.species, f.form)
          next if allowed.empty? || !allowed.include?(f.ability.to_s)

          expected = allowed[f.ability_index]
          [info('ability_index_mismatch', f.ability.to_s, index: f.ability_index, expected: expected)] if expected && expected != f.ability.to_s
        }),
        Rule.new('iv_range', :basic, lambda { |c, f|
          max = c.limits[:ivMax]
          f.iv.filter_map { |stat, v| ill('iv_range', stat, value: v, min: 0, max: max) if v && (v.negative? || v > max) }.then { |l| l unless l.empty? }
        }),
        Rule.new('ev_range', :basic, lambda { |c, f|
          max = c.limits[:evStatMax]
          f.ev.filter_map { |stat, v| ill('ev_range', stat, value: v, min: 0, max: max) if v && (v.negative? || v > max) }.then { |l| l unless l.empty? }
        }),
        Rule.new('ev_total', :basic, lambda { |c, f|
          total = f.ev.values.compact.sum
          [ill('ev_total', nil, total: total, max: c.limits[:evTotalMax])] if total > c.limits[:evTotalMax]
        }),
        Rule.new('happiness_range', :basic, lambda { |c, f|
          max = c.limits[:happinessMax]
          [ill('happiness_range', nil, value: f.happiness, min: 0, max: max)] if f.happiness && (f.happiness.negative? || f.happiness > max)
        }),
        Rule.new('hp_negative', :basic, lambda { |_c, f|
          [ill('hp_negative', nil, value: f.hp)] if f.hp && f.hp.negative?
        }),
        Rule.new('hp_over_total', :basic, lambda { |_c, f|
          total = f.stats['HP']
          [ill('hp_over_total', nil, hp: f.hp, totalHp: total)] if f.hp && total && f.hp > total
        }),
        Rule.new('status_invalid', :basic, lambda { |_c, f|
          st = f.status
          next if st.nil?

          ok = st.is_a?(Integer) ? st.between?(0, 5) : STATUSES.include?(st.to_s.upcase)
          [warn('status_invalid', nil, value: st.to_s)] unless ok
        }),
        Rule.new('moves_count', :basic, lambda { |c, f|
          max = c.limits[:maxMoves]
          [ill('moves_count', nil, count: f.moves.size, max: max)] if f.moves.size > max
        }),
        Rule.new('moves_empty', :basic, lambda { |_c, f|
          [ill('moves_empty')] if f.moves.empty? && !f.egg
        }),
        Rule.new('moves_duplicate', :basic, lambda { |_c, f|
          ids = f.moves.map { |m| m[:id] }.compact
          dup = ids.group_by(&:itself).select { |_, v| v.size > 1 }.keys
          dup.map { |m| ill('moves_duplicate', m.to_s) } unless dup.empty?
        }),
        Rule.new('move_unknown', :moves_data, lambda { |c, f|
          out = f.moves.filter_map { |m| ill('move_unknown', m[:id].to_s) if m[:id] && !c.game.move(m[:id]) }
          out unless out.empty?
        }),
        Rule.new('move_not_learnable', :moves, lambda { |c, f|
          next if f.level.nil? || !species_entry(c, f)

          out = f.moves.filter_map do |m|
            next unless m[:id] && c.game.move(m[:id])

            ill('move_not_learnable', m[:id].to_s, level: f.level) unless c.game.move_learnable?(f.species, f.form, f.level, m[:id])
          end
          out unless out.empty?
        }),
        Rule.new('pp_over_total', :moves_data, lambda { |c, f|
          out = f.moves.filter_map do |m|
            next if m[:pp].nil? || m[:id].nil?

            data = c.game.move(m[:id])
            next unless data&.total_pp

            max = data.total_pp + (data.total_pp * (m[:ppup] || 0) / 5)
            ill('pp_over_total', m[:id].to_s, pp: m[:pp], max: max) if m[:pp] > max || m[:pp].negative?
          end
          out unless out.empty?
        }),
        Rule.new('ppups_range', :basic, lambda { |_c, f|
          out = f.moves.filter_map { |m| ill('ppups_range', m[:id].to_s, value: m[:ppup]) if m[:ppup] && !m[:ppup].between?(0, 3) }
          out unless out.empty?
        }),
        Rule.new('item_unknown', :items, lambda { |c, f|
          [ill('item_unknown', f.item.to_s)] if f.item && f.item != 0 && !c.game.item(f.item)
        }),
        Rule.new('ball_unknown', :items, lambda { |c, f|
          [ill('ball_unknown', f.ball.to_s)] if f.ball && f.ball != 0 && !c.game.item(f.ball)
        }),
        Rule.new('ball_not_pokeball', :items, lambda { |c, f|
          next unless f.ball && f.ball != 0

          it = c.game.item(f.ball)
          # Solo si el juego marca sus balls con la bandera "PokeBall" (Essentials v20+).
          next unless it && c.game.table(:items).values.any? { |x| x.flags.include?('PokeBall') }

          [warn('ball_not_pokeball', f.ball.to_s)] unless it.flags.include?('PokeBall')
        }),
        Rule.new('nickname_too_long', :nickname_limit, lambda { |c, f|
          max = c.limits[:maxNickname]
          [ill('nickname_too_long', nil, length: f.nickname.length, max: max)] if f.nickname && f.nickname.length > max
        }),
        Rule.new('owner_name_too_long', :player_name_limit, lambda { |c, f|
          max = c.limits[:maxPlayerName]
          [ill('owner_name_too_long', nil, length: f.owner_name.length, max: max)] if f.owner_name && f.owner_name.length > max
        }),
        Rule.new('stats_mismatch', :stats, lambda { |c, f|
          next if f.level.nil? || f.stats.values.any?(&:nil?) || f.iv.values.any?(&:nil?) || f.ev.values.any?(&:nil?)

          base = c.game.base_stats(f.species, f.form)
          next if base.size < 6

          expected = GameData::Tables.calc_all(base, f.level, f.iv, f.ev, f.nature_for_stats || f.nature)
          bad = expected.keys.reject { |s| expected[s] == f.stats[s] }
          [warn('stats_mismatch', nil, stats: bad)] unless bad.empty?
        })
      ].freeze
    end
  end
end
