# =============================================================================
# tables.rb — Tablas y formulas del motor de Essentials que NO viven en los
# `.dat` del juego (estan en los scripts) y por tanto se embeben aqui:
# grupos de experiencia, ratios de genero, naturalezas y calculo de stats.
# Todo es aritmetica entera, igual que el motor.
# =============================================================================

module Sem
  module GameData
    module Tables
      STATS = %w[HP ATTACK DEFENSE SPECIAL_ATTACK SPECIAL_DEFENSE SPEED].freeze
      DEFAULT_MAX_LEVEL = 100

      # Las 25 naturalezas en el orden del motor. [id, stat que sube, stat que baja]
      # (nil = neutra).
      NATURES = [
        ['HARDY', nil, nil], ['LONELY', 'ATTACK', 'DEFENSE'], ['BRAVE', 'ATTACK', 'SPEED'],
        ['ADAMANT', 'ATTACK', 'SPECIAL_ATTACK'], ['NAUGHTY', 'ATTACK', 'SPECIAL_DEFENSE'],
        ['BOLD', 'DEFENSE', 'ATTACK'], ['DOCILE', nil, nil], ['RELAXED', 'DEFENSE', 'SPEED'],
        ['IMPISH', 'DEFENSE', 'SPECIAL_ATTACK'], ['LAX', 'DEFENSE', 'SPECIAL_DEFENSE'],
        ['TIMID', 'SPEED', 'ATTACK'], ['HASTY', 'SPEED', 'DEFENSE'], ['SERIOUS', nil, nil],
        ['JOLLY', 'SPEED', 'SPECIAL_ATTACK'], ['NAIVE', 'SPEED', 'SPECIAL_DEFENSE'],
        ['MODEST', 'SPECIAL_ATTACK', 'ATTACK'], ['MILD', 'SPECIAL_ATTACK', 'DEFENSE'],
        ['QUIET', 'SPECIAL_ATTACK', 'SPEED'], ['BASHFUL', nil, nil],
        ['RASH', 'SPECIAL_ATTACK', 'SPECIAL_DEFENSE'], ['CALM', 'SPECIAL_DEFENSE', 'ATTACK'],
        ['GENTLE', 'SPECIAL_DEFENSE', 'DEFENSE'], ['SASSY', 'SPECIAL_DEFENSE', 'SPEED'],
        ['CAREFUL', 'SPECIAL_DEFENSE', 'SPECIAL_ATTACK'], ['QUIRKY', nil, nil]
      ].freeze
      NATURE_IDS = NATURES.map(&:first).freeze

      # Ratio de genero: probabilidad de hembra sobre 256 (nil = sin genero),
      # y el unico genero posible cuando solo hay uno (0 macho, 1 hembra, 2 sin genero).
      GENDER_RATIOS = {
        'AlwaysMale' => { female: 0, only: 0 }, 'AlwaysFemale' => { female: 256, only: 1 },
        'Genderless' => { female: nil, only: 2 }, 'FemaleOneEighth' => { female: 32 },
        'Female25Percent' => { female: 64 }, 'Female50Percent' => { female: 128 },
        'Female75Percent' => { female: 192 }, 'FemaleSevenEighths' => { female: 224 }
      }.freeze

      GROWTH_RATES = %w[Medium Erratic Fluctuating Parabolic Fast Slow].freeze
      # Sinonimos usados por distintas versiones / bases.
      GROWTH_ALIASES = {
        'MEDIUM' => 'Medium', 'MEDIUMFAST' => 'Medium', 'MEDIUM_FAST' => 'Medium',
        'ERRATIC' => 'Erratic', 'FLUCTUATING' => 'Fluctuating',
        'PARABOLIC' => 'Parabolic', 'MEDIUMSLOW' => 'Parabolic', 'MEDIUM_SLOW' => 'Parabolic',
        'FAST' => 'Fast', 'SLOW' => 'Slow'
      }.freeze

      module_function

      def growth_rate_id(raw)
        key = raw.to_s.upcase
        GROWTH_ALIASES[key] || GROWTH_RATES.find { |g| g.casecmp?(raw.to_s) } || 'Medium'
      end

      # Experiencia total necesaria para estar en `level` (nivel 1 = 0).
      def exp_at(rate, level)
        n = level.to_i
        return 0 if n <= 1

        c = n**3
        case growth_rate_id(rate)
        when 'Erratic'
          if n <= 50 then (c * (100 - n)) / 50
          elsif n <= 68 then (c * (150 - n)) / 100
          elsif n <= 98 then (c * ((1911 - (10 * n)) / 3)) / 500
          else (c * (160 - n)) / 100
          end
        when 'Fluctuating'
          if n <= 15 then (c * (((n + 1) / 3) + 24)) / 50
          elsif n <= 35 then (c * (n + 14)) / 50
          else (c * ((n / 2) + 32)) / 50
          end
        when 'Parabolic' then ((6 * c) / 5) - (15 * (n**2)) + (100 * n) - 140
        when 'Fast' then (4 * c) / 5
        when 'Slow' then (5 * c) / 4
        else c
        end
      end

      # Nivel que corresponde a una experiencia (el maximo con exp_at <= exp).
      def level_for_exp(rate, exp, max_level = DEFAULT_MAX_LEVEL)
        return 1 if exp.nil? || exp <= 0

        lo = 1
        (2..max_level).each do |lv|
          break if exp_at(rate, lv) > exp

          lo = lv
        end
        lo
      end

      def nature_index(id)
        NATURE_IDS.index(id.to_s.upcase)
      end

      # Multiplicador (100/110/90) de la naturaleza para un stat.
      def nature_multiplier(nature_id, stat)
        row = NATURES[nature_index(nature_id) || -1]
        return 100 unless row

        return 110 if row[1] == stat
        return 90 if row[2] == stat

        100
      end

      def calc_hp(base, level, iv, ev)
        return 1 if base == 1 # Shedinja

        ((((2 * base) + iv + (ev / 4)) * level) / 100) + level + 10
      end

      def calc_stat(base, level, iv, ev, multiplier)
        (((((2 * base) + iv + (ev / 4)) * level) / 100) + 5) * multiplier / 100
      end

      # stats = { 'HP' => n, ... } a partir de base/iv/ev (hashes por stat).
      def calc_all(base_stats, level, iv, ev, nature_id)
        STATS.to_h do |s|
          b = base_stats[s].to_i
          i = iv[s].to_i
          e = ev[s].to_i
          v = s == 'HP' ? calc_hp(b, level, i, e) : calc_stat(b, level, i, e, nature_multiplier(nature_id, s))
          [s, v]
        end
      end
    end
  end
end
