# Utilidades comunes de los tests del driver (minitest).
#
#   ruby -Itest test/protocol_test.rb        (un archivo)
#   ruby -Itest -e 'Dir["test/**/*_test.rb"].each { |f| require "./#{f}" }'   (todos)
#
# REGLA: nunca se modifica test_saves/ — todo lo que escribe trabaja sobre una
# copia temporal (`with_save_copy`).

require 'minitest/autorun'
require 'json'
require 'open3'
require 'tmpdir'
require 'fileutils'

ROOT = File.expand_path('..', __dir__)
SAVES_DIR = File.join(ROOT, 'test_saves')
DRIVER_PATH = File.join(ROOT, 'driver', 'rxdata_driver.rb')

require DRIVER_PATH

# Ejecuta comandos del driver en el mismo proceso (rapido). Normaliza entrada
# y salida a JSON puro (claves String) para que los asserts lean igual que el
# protocolo real.
class Harness
  attr_reader :ctx

  def initialize
    @ctx = Commands::Context.new
  end

  def call(cmd, params = {})
    req = JSON.parse(JSON.generate(params))
    data = Commands.dispatch(@ctx, cmd, req)
    out = JSON.parse(JSON.generate(data))
    # `id` y `ok` son del protocolo: si un comando los devuelve pisan los de la respuesta (el crate Rust ve un `id` que no
    # es el de su peticion, da la sesion por desincronizada y la da de baja: el save «se desconecta» de la app).
    clobbered = Protocol::RESERVED_KEYS & out.keys
    raise "el comando #{cmd} devuelve claves reservadas del protocolo: #{clobbered.inspect}" unless clobbered.empty?

    out
  end

  def session
    @ctx.session
  end

  def open(path, **opts)
    call('open', { 'path' => path, 'autodetect' => false }.merge(opts.transform_keys(&:to_s)))
  end
end

# Cliente del protocolo real por stdin/stdout (proceso hijo).
class DriverClient
  def initialize
    @stdin, @stdout, @stderr, @wait = Open3.popen3('ruby', '-E', 'UTF-8', DRIVER_PATH)
    @err_thread = Thread.new { @stderr.read }
    @id = 0
  end

  # Igual que el crate Rust: la respuesta debe traer el `id` de la peticion (si no, la sesion se da por desincronizada).
  def call(cmd, **params)
    @id += 1
    @stdin.puts(JSON.generate(params.merge(id: @id, cmd: cmd)))
    resp = JSON.parse(@stdout.gets)
    raise "desincronizado en #{cmd}: esperaba id #{@id}, llego #{resp['id'].inspect}" unless resp['id'] == @id

    resp
  end

  def close
    call('shutdown')
    @stdin.close
    @wait.value
  rescue StandardError
    nil
  end
end

module SaveFixtures
  # Copia un save de test_saves/ a un directorio temporal y cede la ruta.
  def with_save_copy(name)
    Dir.mktmpdir('peshex_test') do |dir|
      dest = File.join(dir, name)
      FileUtils.cp(File.join(SAVES_DIR, name), dest)
      yield dest
    end
  end

  def save_path(name)
    File.join(SAVES_DIR, name)
  end
end

class Minitest::Test
  include SaveFixtures
end
