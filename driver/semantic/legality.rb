# =============================================================================
# legality.rb — Modos HeX / HaX y legalidad. Carga ordenada de legality/*.
#
#   HaX  (por defecto) permite cualquier edicion y solo muestra las flags
#   HeX  no deja INTRODUCIR ilegalidades segun las reglas del juego vinculado
# =============================================================================

module Sem
  module Legality
    MODES = %w[hex hax].freeze
    DEFAULT_MODE = 'hax'
  end
end

%w[flags context rules_pokemon rules_misc engine guard].each { |f| require_relative "legality/#{f}" }
