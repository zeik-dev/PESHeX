# Corre todos los tests de minitest (test/**/*_test.rb): ruby -Itest scripts/run_ruby_tests.rb
# (un script en vez de `ruby -e '...'` para no depender del entrecomillado de cada shell, sobre todo en Windows).
Dir[File.expand_path('../test/**/*_test.rb', __dir__)].sort.each { |f| require f }
