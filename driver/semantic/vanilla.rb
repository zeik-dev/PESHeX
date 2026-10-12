# =============================================================================
# vanilla.rb — Listas de ivars CONOCIDOS de Essentials por entidad. Sirven para
# separar, en los "extras" de cada entidad, lo vanilla que la UI no muestra en
# un control propio de lo realmente personalizado por la base (plugins).
# =============================================================================

module Sem
  module Vanilla
    # Ivars que la capa semantica muestra con controles propios (por entidad).
    POKEMON_DISPLAYED = %w[
      @species @form @name @nickname @level @exp @gender @genderflag @shiny @shinyflag @super_shiny
      @nature @natureflag @nature_for_stats @ability @abilityflag @ability_index @abilityIndex
      @item @status @statusCount @happiness @poke_ball @ballused @hp @totalhp @attack @defense @spatk @spdef
      @speed @iv @ev @moves @owner @ot @trainerID @personalID @personal_id @steps_to_hatch @eggsteps
    ].freeze

    # Otros ivars vanilla (v16-v21): se muestran en "otros datos", no como custom.
    POKEMON_OTHER = %w[
      @forced_form @time_form_set @first_moves @ribbons @mail @cool @beauty @cute @smart @tough @sheen
      @pokerus @markings @ivMaxed @obtain_method @obtain_map @obtain_text @obtain_level @hatched_map
      @timeReceived @timeEggHatched @fused @ready_to_evolve @cannot_store @cannot_release @cannot_trade
      @otgender @language @obtainMode @obtainMap @obtainText @obtainLevel @hatchedMap @markings @cool
    ].freeze

    TRAINER_DISPLAYED = %w[
      @name @id @trainer_type @trainertype @gender @language @party @badges @money @coins @battle_points
      @battlePoints @soot @pokedex @publicID @metaID
    ].freeze

    TRAINER_OTHER = %w[
      @character_ID @outfit @has_pokedex @has_pokegear @has_running_shoes @seen_storage_creator
      @mystery_gift_unlocked @mystery_gifts @secretBase @lastSave
    ].freeze

    BAG_DISPLAYED = %w[@pockets @bag @items].freeze
    BAG_OTHER = %w[
      @last_viewed_pocket @last_pocket_selections @registered_items @ready_menu_selection
      @lastpocket @choices @registeredItems
    ].freeze

    STORAGE_DISPLAYED = %w[@boxes @currentBox].freeze
    STORAGE_OTHER = %w[@boxmode @unlockedWallpapers].freeze

    BOX_DISPLAYED = %w[@name @pokemon].freeze
    BOX_OTHER = %w[@background].freeze

    def self.known(displayed, other)
      displayed + other
    end
  end
end
