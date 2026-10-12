# =============================================================================
# pbs.rb — Lector de respaldo de los archivos PBS/*.txt. Se usa cuando no hay
# `.dat` legibles (Essentials v16-v18, o una carpeta de desarrollo). Soporta:
#
#   * formato INI de v19+:   [BULBASAUR] / Name = Bulbasaur / BaseStats = 45,49,...
#   * formato CSV de v16-v18: 1,POUND,Pound,000,40,NORMAL,Physical,100,35,...
#
# Es de MEJOR ESFUERZO (sin muestras reales de v16-v18): solo extrae nombres y
# los datos basicos; si algo no cuadra, ese registro se ignora.
# =============================================================================

module Sem
  module GameData
    module Pbs
      module_function

      def read_text(path)
        File.binread(path).force_encoding('UTF-8').scrub.delete_prefix("﻿")
      end

      def lines(text)
        text.each_line.map(&:strip).reject { |l| l.empty? || l.start_with?('#') }
      end

      # [[encabezado, { 'Clave' => 'valor' }], ...] del formato INI.
      def ini_sections(text)
        out = []
        cur = nil
        lines(text).each do |l|
          if l =~ /\A\[(.+)\]\z/
            cur = [Regexp.last_match(1).strip, {}]
            out << cur
          elsif cur && l =~ /\A([^=]+?)\s*=\s*(.*)\z/
            cur[1][Regexp.last_match(1).strip] = Regexp.last_match(2).strip
          end
        end
        out
      end

      def csv_rows(text)
        lines(text).filter_map do |l|
          next unless l =~ /\A\d+\s*,/

          l.split(',', -1).map(&:strip)
        end
      end

      def csv?(text)
        lines(text).first.to_s.match?(/\A\d+\s*,/)
      end

      def list(value)
        value.to_s.split(',').map(&:strip).reject(&:empty?)
      end

      def pairs_moves(value)
        list(value).each_slice(2).filter_map { |lv, mv| lv =~ /\A\d+\z/ && mv ? [lv.to_i, mv] : nil }
      end

      def triples_evo(value)
        list(value).each_slice(3).filter_map do |sp, method, param|
          sp && method ? { species: sp, method: method, param: param =~ /\A\d+\z/ ? param.to_i : param, prevo: false } : nil
        end
      end

      def num(v)
        v.to_s =~ /\A-?\d+\z/ ? v.to_i : nil
      end

      def stats_from(value)
        # Orden del PBS: HP, Attack, Defense, Speed, Sp.Atk, Sp.Def
        order = %w[HP ATTACK DEFENSE SPEED SPECIAL_ATTACK SPECIAL_DEFENSE]
        list(value).each_with_index.each_with_object({}) { |(v, i), h| h[order[i]] = v.to_i if order[i] }
      end

      # ── Especies ──────────────────────────────────────────────────────────
      def species(text)
        ini_sections(text).filter_map do |header, f|
          number = nil
          id = header
          if header =~ /\A\d+\z/
            number = header.to_i
            id = f['InternalName']
          elsif header.include?(',')
            sp, form = header.split(',', 2).map(&:strip)
            id = "#{sp}_#{form}"
          end
          next unless id

          base = id.sub(/_\d+\z/, '')
          types = f['Types'] ? list(f['Types']) : [f['Type1'], f['Type2']].compact.reject(&:empty?)
          Species.new(
            id: id, species: base, form: id =~ /_(\d+)\z/ ? Regexp.last_match(1).to_i : 0, number: number,
            name: f['Name'], form_name: f['FormName'], types: types.map(&:upcase).uniq,
            base_stats: stats_from(f['BaseStats']), growth_rate: Tables.growth_rate_id(f['GrowthRate']),
            gender_ratio: f['GenderRatio'] || f['GenderRate'], moves: pairs_moves(f['Moves']),
            tutor_moves: list(f['TutorMoves']), egg_moves: list(f['EggMoves']),
            abilities: list(f['Abilities']), hidden_abilities: list(f['HiddenAbilities'] || f['HiddenAbility']),
            evolutions: triples_evo(f['Evolutions']), base_exp: num(f['BaseEXP'] || f['BaseExp']), flags: list(f['Flags'])
          )
        end
      end

      # ── Movimientos ───────────────────────────────────────────────────────
      def moves(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            next if c.size < 9

            Move.new(id: c[1], number: c[0].to_i, name: c[2], power: num(c[4]), type: c[5], category: category_index(c[6]),
                     accuracy: num(c[7]), total_pp: num(c[8]), flags: [])
          end
        else
          ini_sections(text).map do |id, f|
            Move.new(id: id, name: f['Name'], type: f['Type'], category: category_index(f['Category']),
                     power: num(f['Power']), accuracy: num(f['Accuracy']), total_pp: num(f['TotalPP']), flags: list(f['Flags']))
          end
        end
      end

      def category_index(v)
        case v.to_s.downcase
        when 'physical', '0' then 0
        when 'special', '1' then 1
        when 'status', '2' then 2
        end
      end

      # ── Objetos ───────────────────────────────────────────────────────────
      def items(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            next if c.size < 5

            Item.new(id: c[1], number: c[0].to_i, name: c[2], name_plural: c[3], pocket: num(c[4]), price: num(c[5]),
                     field_use: num(c[7]), move: c[10], flags: [])
          end
        else
          ini_sections(text).map do |id, f|
            Item.new(id: id, name: f['Name'], name_plural: f['NamePlural'], pocket: num(f['Pocket']), price: num(f['Price']),
                     field_use: field_use_index(f['FieldUse']), move: f['Move'], flags: list(f['Flags']))
          end
        end
      end

      def field_use_index(v)
        { 'TM' => 3, 'HM' => 4, 'TR' => 5 }[v.to_s] || num(v)
      end

      # ── Habilidades ───────────────────────────────────────────────────────
      def abilities(text)
        if csv?(text)
          csv_rows(text).filter_map do |c|
            c.size >= 3 ? Ability.new(id: c[1], number: c[0].to_i, name: c[2], description: c[3]) : nil
          end
        else
          ini_sections(text).map { |id, f| Ability.new(id: id, name: f['Name'], description: f['Description']) }
        end
      end

      def types(text)
        ini_sections(text).map { |id, f| TypeInfo.new(id: id, name: f['Name']) }
      end
    end
  end
end
