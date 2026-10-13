#!/usr/bin/env ruby
# Prueba de humo del driver con el Ruby que se distribuye: ¿arranca, abre una partida y responde?
#
#   ruby scripts/smoke_driver.rb --driver <.../rxdata/driver/rxdata_driver.rb> --save <partida.rxdata>
#
# Lo usa scripts/smoke-release.ps1 sobre el zip YA extraido (con el PATH reducido), pero tambien
# sirve en Linux/macOS: `ruby scripts/smoke_driver.rb --driver driver/rxdata_driver.rb --save test_saves/Partida_2.rxdata`.

require 'json'
require 'open3'
require 'optparse'
require 'rbconfig'

opts = {}
OptionParser.new do |o|
  o.on('--driver PATH') { |v| opts[:driver] = v }
  o.on('--save PATH') { |v| opts[:save] = v }
  o.on('--expect-name NAME') { |v| opts[:name] = v }
end.parse!
abort 'faltan --driver y --save' unless opts[:driver] && opts[:save]

# La biblioteca estandar que usa el driver debe estar completa en este Ruby.
%w[json zlib ripper optparse fileutils time set open3 tmpdir securerandom stringio].each do |lib|
  require lib
rescue LoadError => e
  abort "FALLO: falta la biblioteca estandar '#{lib}' en este Ruby (#{e.message})"
end

# Se trabaja sobre una COPIA en una ruta con espacios y 'n' con tilde: guardar y restaurar tocan el disco
# (renombrados, copias .bak) y en Windows es donde mas se nota si algo falla. Nunca se modifica el original.
work = File.join(Dir.mktmpdir('peshex-smoke'), "Carpeta con espacios \u00F1")
FileUtils.mkdir_p(work)
save_path = File.join(work, "Partida \u00F1.rxdata")
FileUtils.cp(opts[:save], save_path)

stdin, stdout, stderr, wait = Open3.popen3(RbConfig.ruby, '-E', 'UTF-8', opts[:driver])
err_reader = Thread.new { stderr.read }
$id = 0

def call(stdin, stdout, cmd, **params)
  $id += 1
  stdin.puts(JSON.generate(params.merge(id: $id, cmd: cmd)))
  line = stdout.gets or abort "FALLO: el driver cerro la conexion en '#{cmd}'"
  JSON.parse(line)
end

def check(cond, what)
  abort "FALLO: #{what}" unless cond
  puts "  ok  #{what}"
end

puts "Ruby #{RUBY_VERSION} (#{RUBY_PLATFORM}) en #{RbConfig.ruby}"
r = call(stdin, stdout, 'ping')
check(r['ok'] && r['pong'], 'ping')

r = call(stdin, stdout, 'open', path: save_path, autodetect: false)
check(r['ok'], "open #{File.basename(save_path)} (#{r.dig('error', 'message')})")
check(r.dig('profile', 'id') == 'essentials_savedata', "perfil detectado: #{r.dig('profile', 'id')}")
check(r['mode'] == 'hax', 'modo por defecto HaX')

r = call(stdin, stdout, 'get_overview')
check(r['ok'] && r.dig('trainer', 'name'), "entrenador: #{r.dig('trainer', 'name')}")
check(opts[:name].nil? || r.dig('trainer', 'name') == opts[:name], "nombre esperado #{opts[:name]}") if opts[:name]
check(r['party'].is_a?(Array) && !r['party'].empty?, "equipo con #{r['party']&.size} Pokemon")

r = call(stdin, stdout, 'check_legality')
check(r['ok'] && r.dig('coverage', 'level') == 'basic', 'legalidad basica sin carpeta del juego')

r = call(stdin, stdout, 'apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 1234 }], mode: 'hax')
check(r['ok'] && r['applied'], 'edicion aplicada en HaX')
r = call(stdin, stdout, 'undo')
check(r['ok'] && r['applied'], 'deshacer')

# Guardar de verdad, comprobar la copia .bak, restaurarla y reabrir: el estado original vuelve.
original_money = call(stdin, stdout, 'get_trainer').dig('trainer', 'money')
r = call(stdin, stdout, 'apply_ops', ops: [{ op: 'set', ref: 'trainer', field: 'money', value: 4321 }], mode: 'hax')
check(r['ok'] && r['applied'], 'edicion aplicada antes de guardar')
r = call(stdin, stdout, 'save', backup: true, confirmed: true)
check(r['ok'] && r['applied'] && r['backupPath'] && File.exist?(r['backupPath']), "guardado en disco con copia de seguridad (#{r.dig('error', 'message')})")
backups = call(stdin, stdout, 'list_backups')['backups']
check(backups.is_a?(Array) && backups.size == 1, 'la copia aparece en list_backups')
r = call(stdin, stdout, 'restore_backup', file: backups.first['file'])
check(r['ok'] && r['restored'] == backups.first['file'], "copia restaurada (#{r.dig('error', 'message')})")
call(stdin, stdout, 'close')
r = call(stdin, stdout, 'open', path: save_path, autodetect: false)
check(r['ok'], 'reabrir tras restaurar')
check(call(stdin, stdout, 'get_trainer').dig('trainer', 'money') == original_money, "dinero original tras restaurar (#{original_money})")

r = call(stdin, stdout, 'get_catalog')
check(!r['ok'] && r.dig('error', 'type') == 'GameFolderRequired', 'sin carpeta de juego, get_catalog da un error claro')

call(stdin, stdout, 'shutdown')
stdin.close
status = wait.value
abort "FALLO: el driver termino con #{status.exitstatus}\n#{err_reader.value}" unless status.success?
FileUtils.rm_rf(File.dirname(work))
puts "SMOKE OK (Ruby #{RUBY_VERSION})"
