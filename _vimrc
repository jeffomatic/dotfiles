" Some default settings
syntax enable
filetype plugin indent on

set hidden " Switch buffers without requiring a save
set number " Show line numbers
set ruler " Show columns
set expandtab " Convert tabs to spaces...
autocmd FileType make setlocal noexpandtab " ...except for Makefiles
set shiftwidth=2
set softtabstop=2
set clipboard=unnamed " Yank into system clipboard

