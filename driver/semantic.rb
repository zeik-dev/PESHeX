# =============================================================================
# semantic.rb — Capa semantica Pokemon sobre el arbol Marshal: deteccion de la
# base de Essentials, vistas visuales (entrenador, equipo, PC, bolsa) y
# cobertura de clasificacion. Carga ordenada de driver/semantic/*.
# =============================================================================

require 'time'

module Sem; end

require_relative 'semantic/tree'
require_relative 'semantic/claims'
require_relative 'semantic/codecs'
require_relative 'semantic/shapes'
require_relative 'semantic/scan'
require_relative 'semantic/profiles'
require_relative 'semantic/detector'
require_relative 'semantic/vanilla'
require_relative 'semantic/facts'
require_relative 'semantic/gamedata'
require_relative 'semantic/model'
require_relative 'semantic/legality'
require_relative 'semantic/coverage'
require_relative 'semantic/ops'
require_relative 'semantic/journal'
require_relative 'semantic/validator'
require_relative 'semantic/editor_pc'
require_relative 'semantic/editor'
require_relative 'semantic/state'
